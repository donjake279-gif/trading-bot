// The expansion systems: notifications, servers, progression, goals,
// contracts, investments, publishing, policies, calendar and inbox events.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, hire, releasePlayerGame } from '../actions';
import { resolveDecision } from '../events';
import { deserializeWorld, serializeWorld } from '../save';
import { SERVER_TIERS, focus } from '../constants';
import { buyNodes, infraCapacity, infraDaily, infraEffects, sellNodes, setServerTier, tierBlocker } from '../infra';
import { addXp, objectiveProgress, perkRank, spendPerk } from '../progression';
import { playerSpeedMods } from '../development';
import { abandonContract, acceptContract, refreshContractOffers } from '../contracts';
import { fundPublishing, investmentValue, moveBonds, policyMonthlyCost, publishingOpportunities, setPolicies, tradeIndexFund } from '../business';
import { ccuMult, saleActive, shopperMult } from '../calendar';
import { resolveOpportunity } from '../opportunities';
import { updateFatigue } from '../updates';
import type { Game, MultiplayerId, World } from '../types';
import { notify, playerCompany } from '../util';

const opts = { seed: 'exp-1', companyName: 'Expansion', founderName: 'E', specialty: 'programmer' as const, difficulty: 'normal' as const, rivals: 16 };

function liveGame(w: World, multiplayer: MultiplayerId = 'single'): Game {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title: `Live ${multiplayer}`, genre: 'indie', platforms: ['pc'], audience: 'casual', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer, scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
  const g = w.games[r.id!];
  while (g.workDone < g.workRequired) advanceDay(w);
  expect(releasePlayerGame(w, g.id).ok).toBe(true);
  return g;
}

describe('notifications', () => {
  it('records history and never pauses the game', () => {
    const w = createWorld(opts);
    notify(w, { title: 'Hello', tone: 'good', category: 'studio' });
    expect(w.notices[0].title).toBe('Hello');
    expect(w.notices[0].read).toBe(false);
    for (let i = 0; i < 400; i++) notify(w, { title: `n${i}`, silent: true });
    expect(w.notices.length).toBeLessThanOrEqual(300);
    advanceDays(w, 400);
    expect(w.pauseReason ?? null).toBeNull();
  });

  it('has no poaching events left', () => {
    const w = createWorld({ ...opts, seed: 'poach-check' });
    for (const k of w.player.candidates.slice(0, 2)) hire(w, k.id);
    const kinds = new Set<string>();
    for (let d = 0; d < 365 * 3; d++) {
      advanceDay(w);
      for (const ev of w.pendingEvents) kinds.add(ev.kind);
      for (const ev of [...w.pendingEvents]) resolveDecision(w, ev.id, ev.defaultOption ?? ev.options[ev.options.length - 1].id);
      if (w.player.gameOver) break;
    }
    expect(kinds.has('poach')).toBe(false);
  });
});

describe('server infrastructure', () => {
  it('overload turns players away and upgrades fix it', () => {
    const w = createWorld(opts);
    playerCompany(w).cash = 5e6;
    playerCompany(w).reputation = 30;
    const g = liveGame(w, 'online');
    w.player.infra.autoscale = false;
    g.ccu = infraCapacity(w) * 3;
    infraDaily(w);
    expect(w.player.infra.load).toBeGreaterThan(2.5);
    const fx = infraEffects(w);
    expect(fx.acquire).toBeLessThan(0.3);
    expect(fx.churn).toBeGreaterThan(1.5);
    expect(fx.score).toBeLessThan(0);
    expect(w.notices.some((n) => n.category === 'server')).toBe(true);

    const cap = infraCapacity(w);
    expect(buyNodes(w, 2).ok).toBe(true);
    expect(infraCapacity(w)).toBe(cap + 2 * SERVER_TIERS[0].nodeCapacity);
    expect(setServerTier(w, 2).ok).toBe(true);
    expect(infraCapacity(w)).toBeGreaterThanOrEqual(cap + 2 * SERVER_TIERS[0].nodeCapacity);
    infraDaily(w);
    expect(w.player.infra.load).toBeLessThan(1);
    expect(infraEffects(w).acquire).toBe(1);
    expect(sellNodes(w, 99).ok).toBe(w.player.infra.nodes > 1);
  });

  it('gates tiers behind reputation and research', () => {
    const w = createWorld(opts);
    playerCompany(w).cash = 1e9;
    playerCompany(w).reputation = 0;
    expect(tierBlocker(w, 1)).toMatch(/reputation/);
    playerCompany(w).reputation = 99;
    expect(tierBlocker(w, 3)).toMatch(/research/);
    expect(setServerTier(w, 4).ok).toBe(false);
  });

  it('autoscales with demand and bills the player', () => {
    const w = createWorld(opts);
    playerCompany(w).cash = 1e6;
    const g = liveGame(w, 'online');
    const nodes = w.player.infra.nodes;
    g.ccu = infraCapacity(w) * 1.5;
    const servers = playerCompany(w).ledger.servers;
    infraDaily(w);
    expect(w.player.infra.nodes).toBeGreaterThan(nodes);
    expect(playerCompany(w).ledger.servers).toBeGreaterThan(servers);
  });
});

describe('progression', () => {
  it('levels up, grants perk points and perks change the simulation', () => {
    const w = createWorld(opts);
    const base = playerSpeedMods(w);
    addXp(w, 5000);
    const pr = w.player.progression;
    expect(pr.level).toBeGreaterThan(3);
    expect(pr.perkPoints).toBe(pr.level - 1);
    expect(spendPerk(w, 'prototyping').ok).toBe(true);
    expect(perkRank(w, 'prototyping')).toBe(1);
    expect(playerSpeedMods(w)).toBeCloseTo(base * 1.05, 5);
    expect(spendPerk(w, 'merch').ok).toBe(false); // needs level 10
  });

  it('starts with three goals and pays out when one is met', () => {
    const w = createWorld(opts);
    expect(w.player.objectives.length).toBe(3);
    const o = w.player.objectives[0];
    o.target = Math.min(o.target, objectiveProgress(w, o)) - 1e9; // met no matter how it moves overnight
    const cash = playerCompany(w).cash;
    advanceDay(w);
    expect(w.player.objectivesCompleted).toBe(1);
    expect(playerCompany(w).cash).toBeGreaterThan(cash - 5000 + o.rewardCash * 0.5);
    expect(w.player.objectives.length).toBe(3);
  });
});

describe('contracts', () => {
  it('pays on delivery and costs reputation when abandoned', () => {
    const w = createWorld(opts);
    refreshContractOffers(w);
    const offer = [...w.player.contractOffers].sort((a, b) => a.work - b.work)[0];
    const founder = w.player.employees[0];
    expect(acceptContract(w, offer.id, [founder.id]).ok).toBe(true);
    expect(founder.assignment).toBe(w.player.contracts[0].id);
    const before = playerCompany(w).ledger.contracts;
    for (let i = 0; i < 400 && w.player.contracts.length; i++) advanceDay(w);
    expect(w.player.contractsCompleted).toBe(1);
    expect(founder.assignment).toBeNull();
    const earned = playerCompany(w).ledger.contracts - before + playerCompany(w).monthly.reduce((s, m) => s + m.ledger.contracts, 0);
    expect(earned).toBeGreaterThan(0);

    refreshContractOffers(w);
    const rep = playerCompany(w).reputation;
    expect(acceptContract(w, w.player.contractOffers[0].id, [founder.id]).ok).toBe(true);
    expect(abandonContract(w, w.player.contracts[0].id).ok).toBe(true);
    expect(playerCompany(w).reputation).toBeLessThan(rep);
  });
});

describe('business', () => {
  it('bonds earn interest and the index fund round-trips with a small fee', () => {
    const w = createWorld(opts);
    const p = playerCompany(w);
    p.cash = 1e6;
    expect(moveBonds(w, 500000).ok).toBe(true);
    expect(p.cash).toBe(500000);
    advanceDays(w, 60);
    const interest = p.ledger.investments + p.monthly.reduce((s, m) => s + m.ledger.investments, 0);
    expect(interest).toBeGreaterThan(0);
    expect(moveBonds(w, -500000).ok).toBe(true);
    const cash = p.cash;
    expect(tradeIndexFund(w, 100000).ok).toBe(true);
    expect(investmentValue(w)).toBeCloseTo(99700, -1);
    expect(tradeIndexFund(w, -1e9).ok).toBe(true);
    expect(w.player.investments.indexUnits).toBe(0);
    expect(p.cash).toBeLessThan(cash);
    expect(p.cash).toBeGreaterThan(cash - 1000);
  });

  it('publishing deals pay the player a share of the game revenue', () => {
    const w = createWorld({ ...opts, seed: 'pub-1', rivals: 24 });
    const p = playerCompany(w);
    p.cash = 1e8;
    const opp = publishingOpportunities(w);
    expect(opp.length).toBeGreaterThan(0);
    const g = opp[0];
    expect(fundPublishing(w, g.id).ok).toBe(true);
    expect(g.publisherCut).toBeGreaterThan(0);
    for (let i = 0; i < 900 && g.status === 'development'; i++) advanceDay(w);
    advanceDays(w, 60);
    const earned = p.ledger.publishing + p.monthly.reduce((s, m) => s + m.ledger.publishing, 0);
    if (g.status === 'released') expect(earned).toBeGreaterThan(0);
  });

  it('policies cost money and lift morale', () => {
    const morale = (premium: boolean) => {
      const w = createWorld(opts);
      for (const k of w.player.candidates.slice(0, 3)) hire(w, k.id);
      expect(policyMonthlyCost(w)).toBe(0);
      if (premium) {
        setPolicies(w, { benefits: 'premium', retainer: true });
        expect(policyMonthlyCost(w)).toBeGreaterThan(1300 * 3);
      }
      advanceDays(w, 95);
      const staff = w.player.employees.filter((e) => !e.isFounder);
      return staff.reduce((s, e) => s + e.morale, 0) / staff.length;
    };
    const basic = morale(false);
    const premium = morale(true);
    expect(premium).toBeGreaterThan(basic + 5);
    expect(premium).toBeGreaterThan(60);
  });
});

describe('calendar', () => {
  it('runs seasonal sales and weekly rhythms', () => {
    const w = createWorld(opts);
    let sale = 0;
    let weekend = 0;
    let weekday = 0;
    for (let d = w.day; d < w.day + 365; d++) {
      if (saleActive(d)) sale++;
      const c = ccuMult(d);
      if (c > 1.1) weekend = shopperMult(d);
      if (c < 1) weekday = shopperMult(d);
    }
    expect(sale).toBeGreaterThan(20);
    expect(sale).toBeLessThan(40);
    expect(weekend).toBeGreaterThan(weekday);
  });
});

describe('game dynamics', () => {
  it('repeating the same update tires players', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    expect(updateFatigue(w, g, 'content')).toBe(0);
    g.updates.push({ day: w.day, type: 'content', reception: 60, label: 'x' }, { day: w.day, type: 'content', reception: 60, label: 'y' });
    expect(updateFatigue(w, g, 'content')).toBe(12);
    expect(updateFatigue(w, g, 'hotfix')).toBe(0);
  });

  it('every inbox opportunity resolves cleanly for every option', () => {
    const w = createWorld(opts);
    const p = playerCompany(w);
    p.cash = 1e7;
    const g = liveGame(w, 'online');
    g.owners = 100000;
    g.active = 50000;
    const ip = w.ips[g.ipId];
    const kinds: Record<string, string[]> = {
      storefront: ['feature', 'exclusive', 'decline'],
      film: ['sell', 'license', 'decline'],
      merch: ['accept', 'premium', 'decline'],
      esports: ['sponsor', 'license', 'decline'],
      reviewBomb: ['patch', 'apologize', 'ignore'],
      exploit: ['bounty', 'ignore'],
      burnout: ['retreat', 'bonus', 'ignore'],
      charity: ['donate', 'decline'],
      distressed: ['buy', 'decline'],
      crowdfund: ['launch', 'decline'],
      streamer: ['keys', 'sponsor', 'decline'],
    };
    for (const [kind, options] of Object.entries(kinds)) {
      for (const id of options) {
        const ev = { id: 'x', day: w.day, kind, title: '', body: '', options: [], expiresDay: w.day, data: { gameId: g.id, ipId: ip?.id ?? null, fee: 100, upfront: 100, lump: 100, monthly: 10, cost: 100, bounty: 100, retreat: 100, bonus: 100, amount: 100, companyId: 'none', price: 100, raise: 1000, deadline: 100, loved: true } };
        expect(resolveOpportunity(w, ev, id)).toBe(true);
      }
    }
    expect(Number.isFinite(p.cash)).toBe(true);
    expect(w.player.licenses.length).toBeGreaterThan(0);
  });

  it('a living industry keeps the inbox interesting', () => {
    const w = createWorld({ ...opts, seed: 'inbox-1' });
    playerCompany(w).cash = 2e6;
    for (const k of w.player.candidates.slice(0, 4)) hire(w, k.id);
    const g = liveGame(w, 'online');
    g.owners = 200000;
    g.active = 60000;
    const seen = new Set<string>();
    for (let d = 0; d < 365 * 4; d++) {
      advanceDay(w);
      for (const ev of [...w.pendingEvents]) {
        seen.add(ev.kind);
        resolveDecision(w, ev.id, ev.defaultOption ?? ev.options[ev.options.length - 1].id);
      }
      if (w.player.gameOver) break;
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe('saves', () => {
  it('migrates a save from before the expansion', () => {
    const w = createWorld(opts);
    liveGame(w, 'online');
    const raw = JSON.parse(serializeWorld(w));
    raw.version = 2;
    for (const k of ['infra', 'progression', 'objectives', 'contracts', 'contractOffers', 'policies', 'investments', 'publishing', 'licenses', 'flags', 'rivalId']) delete raw.player[k];
    delete raw.notices;
    for (const id in raw.companies) for (const k of ['contracts', 'investments', 'publishing', 'perks']) delete raw.companies[id].ledger[k];
    const m = deserializeWorld(JSON.stringify(raw));
    expect(m.player.infra.tier).toBe(0);
    expect(m.player.progression.level).toBe(1);
    expect(Array.isArray(m.notices)).toBe(true);
    advanceDays(m, 40);
    expect(m.player.objectives.length).toBe(3);
    expect(Number.isFinite(playerCompany(m).cash)).toBe(true);
  });
});
