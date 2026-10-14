// A scripted player that follows a sensible growth strategy. Used to check
// that progression from a bedroom to a real studio is achievable (and that
// the game can still be lost). Prints a yearly report.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay } from '../tick';
import {
  assignEmployee,
  createGame,
  hire,
  moveOffice,
  releasePlayerGame,
  runCampaign,
  startResearch,
  startUpdate,
  takeLoanOffer,
} from '../actions';
import { resolveDecision } from '../events';
import { GENRES, OFFICES, RESEARCH, ROLES, SCOPES } from '../constants';
import { recommendedBudget } from '../development';
import { monthlyBurn, revenueTTM } from '../finance';
import type { GenreId, RoleId, ScopeId, World } from '../types';
import { playerCompany } from '../util';

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const HIRE_ORDER: RoleId[] = ['artist', 'programmer', 'designer', 'audio', 'programmer', 'artist', 'qa', 'writer', 'designer', 'producer', 'programmer', 'artist', 'marketing', 'audio', 'community'];

function pickGenre(w: World, scope: ScopeId): GenreId {
  const options: GenreId[] = (['indie', 'horror', 'strategy', 'simulation', 'sandbox', 'survival', 'rpg', 'racing', 'fps'] as GenreId[]).filter(
    (g) => SCOPES[GENRES[g].minScope] && Object.keys(SCOPES).indexOf(GENRES[g].minScope) <= Object.keys(SCOPES).indexOf(scope),
  );
  return options.sort((a, b) => w.market.genres[b].trend - w.market.genres[a].trend)[0];
}

function botTick(w: World, log: string[]) {
  const c = playerCompany(w);
  // answer decisions with the first sensible option
  while (w.pendingEvents.length) {
    const ev = w.pendingEvents[0];
    const prefer = ev.kind === 'lifeline' ? ['loan', 'equity'] : ['decline', 'counter', 'accept', 'settle'];
    const opt = prefer.map((id) => ev.options.find((o) => o.id === id && !o.disabled)).find(Boolean) ?? ev.options.find((o) => !o.disabled) ?? ev.options[0];
    resolveDecision(w, ev.id, ev.kind === 'buyout' || ev.kind === 'takeover' ? 'decline' : opt.id);
    if (w.pendingEvents[0] === ev) w.pendingEvents.shift();
    if (ev.kind === 'takeover') break;
  }
  const mine = Object.values(w.games).filter((g) => g.companyId === c.id);
  const dev = mine.filter((g) => g.status === 'development');
  // release when polished a bit
  for (const g of dev) if (g.workDone >= g.workRequired * 1.06) {
    releasePlayerGame(w, g.id);
    log.push(`d${w.day}: released ${g.title} (${g.scope} ${g.genre}) critic ${g.criticScore}`);
  }
  // marketing burst near launch
  for (const g of dev) if (g.workDone > g.workRequired * 0.8 && g.marketingSpent === 0) {
    const camp = g.scope === 'tiny' ? 'social' : g.scope === 'small' ? 'influencer' : g.scope === 'medium' ? 'trailer' : 'expo';
    runCampaign(w, g.id, camp);
  }
  // hire when there is runway
  const burn = monthlyBurn(w, c);
  const rev = Math.max(revenueTTM(c) / 12, 0);
  const cap = OFFICES[w.player.officeLevel].capacity;
  if (w.player.employees.length < cap && c.cash > burn * 8 + 20000 && w.player.candidates.length) {
    const want = HIRE_ORDER[(w.player.employees.length - 1) % HIRE_ORDER.length];
    const k = w.player.candidates.filter((x) => x.role === want).sort((a, b) => b.skill - a.skill)[0] ?? w.player.candidates.filter((x) => ROLES[x.role].dev)[0];
    if (k && k.salary < Math.max(4000, rev * 0.5 + c.cash / 40)) hire(w, k.id);
  }
  // move office when full and rich
  const next = OFFICES[w.player.officeLevel + 1];
  if (next && w.player.employees.length >= cap && c.cash > next.moveCost + next.rent * 10) moveOffice(w, w.player.officeLevel + 1);
  // research
  if (!w.player.research.active) {
    for (const id of ['agile', 'analytics', 'qaAutomation', 'liveOps', 'netcode', 'marketingData', 'communityHub', 'engine1'] as const) {
      if (!w.player.research.completed.includes(id) && c.cash > RESEARCH[id].cost * 4) {
        if (startResearch(w, id).ok) break;
      }
    }
  }
  // start a new project with idle developers
  const idle = w.player.employees.filter((e) => ROLES[e.role].dev && !e.assignment);
  if (dev.length === 0 && idle.length > 0) {
    const n = idle.length;
    const scope: ScopeId = n <= 2 ? 'tiny' : n <= 6 ? 'small' : n <= 22 ? 'medium' : n <= 70 ? 'large' : 'aaa';
    const genre = pickGenre(w, scope);
    const art = scope === 'tiny' || scope === 'small' ? 'pixel' : scope === 'medium' ? 'stylized' : 'realistic';
    const engine = scope === 'tiny' || scope === 'small' ? 'pixelforge' : 'titan';
    const platforms = scope === 'tiny' || scope === 'small' ? ['pc' as const] : c.reputation >= 15 ? ['pc' as const, 'console' as const] : ['pc' as const];
    const budget = Math.min(recommendedBudget(scope, art, platforms), Math.max(0, c.cash * 0.25));
    const res = createGame(
      w,
      {
        title: `Bot ${scope} ${w.day}`,
        genre,
        platforms,
        audience: genre === 'indie' || genre === 'simulation' ? 'casual' : genre === 'strategy' ? 'adults' : 'youngAdults',
        engine,
        monetization: 'premium',
        price: SCOPES[scope].price,
        artStyle: art,
        multiplayer: genre === 'survival' || genre === 'fps' ? 'online' : 'single',
        scope,
        budget,
        focus: { ...GENRES[genre].ideal },
      },
      idle.map((e) => e.id),
    );
    if (!res.ok) log.push(`d${w.day}: could not start game: ${res.error}`);
  }
  // put idle devs on an update for the best live game
  const live = mine.filter((g) => g.status === 'released' && !g.update && g.active > 200).sort((a, b) => b.rev30 - a.rev30)[0];
  const idleNow = w.player.employees.filter((e) => ROLES[e.role].dev && !e.assignment);
  if (live && idleNow.length && dev.length > 0 && w.day - live.lastUpdateDay > 60) {
    startUpdate(w, live.id, 'content', idleNow.slice(0, 2).map((e) => e.id));
  } else if (dev.length > 0) {
    for (const e of idleNow) assignEmployee(w, e.id, dev[0].id);
  }
  // emergency loan
  if (c.cash < 0 && c.loans.length < 2) takeLoanOffer(w, 0);
}

describe('bot player', () => {
  for (const seed of ['bot-1', 'bot-2', 'bot-3']) {
    it(`plays a growth strategy (${seed})`, () => {
      const w = createWorld({ seed, companyName: 'Bot Studio', founderName: 'Bot', specialty: 'designer', difficulty: 'normal', rivals: 22 });
      const log: string[] = [];
      for (let d = 0; d < 365 * 8; d++) {
        botTick(w, log);
        advanceDay(w);
        if (process.env.BOT_DEBUG === seed && w.day % 30 === 0) {
          const c = playerCompany(w);
          const last = c.monthly[c.monthly.length - 1];
          if (last) log.push(`== m d${w.day} cash ${fmt(c.cash)} rev ${fmt(last.revenue)} exp ${fmt(last.expenses)} ${Object.entries(last.ledger).filter(([, v]) => v > 500).map(([k, v]) => `${k}:${fmt(v)}`).join(' ')} staff ${w.player.employees.length} loans ${c.loans.length} events ${w.pendingEvents.map((e) => e.kind).join(',')}`);
        }
        if (w.player.gameOver) break;
        if (w.day % 365 === 0) {
          const c = playerCompany(w);
          log.push(
            `== year ${w.day / 365}: cash ${fmt(c.cash)} rev TTM ${fmt(revenueTTM(c))} valuation ${fmt(c.valuation)} staff ${w.player.employees.length} office ${OFFICES[w.player.officeLevel].name} rep ${c.reputation.toFixed(0)} games ${w.player.stats.gamesReleased} best ${w.player.stats.bestCritic} research ${w.player.research.completed.length} lvl ${w.player.progression.level} goals ${w.player.objectivesCompleted} servers ${w.player.infra.tier}x${w.player.infra.nodes} load ${w.player.infra.load.toFixed(2)} peak ${Math.round(w.player.stats.peakCcu)} xp ${Math.round(w.player.progression.xp)} | ${w.player.objectives.map((o) => o.title).join(' / ')}`,
          );
        }
      }
      if (w.player.gameOver) log.push(`GAME OVER: ${w.player.gameOver.reason} on day ${w.day}`);
      if (process.env.BOT_DEBUG === seed) console.log(w.player.hr.log.map((l) => `d${l.day} ${l.text}`).join("\n"));
      console.log(`---- ${seed}\n${log.filter((l) => l.startsWith('==') || l.startsWith('GAME') || /released/.test(l)).slice(-40).join('\n')}`);
      expect(Number.isFinite(playerCompany(w).cash)).toBe(true);
    });
  }
});
