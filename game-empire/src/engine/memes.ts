// The internet happens to your games: speedrunners, memes, celebrities,
// modders, petitions and rival CEOs who can't keep quiet. Most are free
// boosts; a few are choices that land in the inbox.
import { TOPICS } from './constants';
import { pushDecision } from './events';
import { addXp } from './progression';
import { chance, pick, randInt } from './rng';
import type { DecisionEvent, Game, World } from './types';
import { bumpRep, clamp, fanChange, gamesOf, newId, playerCompany, pushNews, spend, toast } from './util';

const CELEBRITIES = ['pop star Lyra Vance', 'actor Marcus Holt', 'chess champion Anya Petrova', 'astronaut Commander Reyes', 'rapper Lil Quasar', 'TV chef Bruno Castellano', 'skateboarder Kai Mendes'];
const NPCS = ['Gary the Shopkeeper', 'Sir Reginald', 'Doug from Accounting', 'the Angry Goose', 'Captain Biscuit', 'Grandpa Tumbleweed', 'Steve the Slime'];
const GLITCHES = ['horses that launch into orbit', 'a door that is somehow load-bearing', 'NPCs who T-pose when sad', 'a chicken that one-shots the final boss', 'cars that drive better upside down'];
const DISSES = ['a spreadsheet with a soundtrack', 'what happens when you let interns design', 'my nephew could make this in a weekend', 'a tech demo with delusions of grandeur', 'the elevator music of video games'];

function liveHits(w: World, min = 1000): Game[] {
  return gamesOf(w, w.player.companyId).filter((g) => g.status === 'released' && g.active >= min);
}

function boost(g: Game, mult: number, days: number, day: number): void {
  g.viralMult = Math.max(g.viralMult, mult);
  g.viralUntil = Math.max(g.viralUntil, day + days);
}

function ready(w: World, kind: string, cooldown = 400): boolean {
  return w.day - (w.player.flags[`meme:${kind}`] ?? -9999) > cooldown;
}

function mark(w: World, kind: string): void {
  w.player.flags[`meme:${kind}`] = w.day;
  w.player.flags.memeAny = w.day;
}

/** Daily roll for something funny happening to one of your games. */
export function memesDaily(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active' || w.player.gameOver) return;
  if (w.day - (w.player.flags.memeAny ?? -9999) < 35 || !chance(w, 1 / 45)) return;
  const hits = liveHits(w);
  const devs = gamesOf(w, p.id).filter((g) => g.status === 'development');
  const options: (() => boolean)[] = [];

  if (hits.length && ready(w, 'speedrun')) options.push(() => {
    const g = pick(w, hits);
    const mins = randInt(w, 3, 19);
    boost(g, 1.3, 14, w.day);
    mark(w, 'speedrun');
    toast(w, `A speedrunner beat ${g.title} in ${mins} minutes by clipping through a wall`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'The run has millions of views. New players are curious.' });
    return true;
  });
  if (hits.length && ready(w, 'celebrity')) options.push(() => {
    const g = pick(w, hits);
    const who = pick(w, CELEBRITIES);
    boost(g, 1.5, 21, w.day);
    mark(w, 'celebrity');
    pushNews(w, { kind: 'player', title: `${who.charAt(0).toUpperCase()}${who.slice(1)} says ${g.title} is their favourite game`, gameId: g.id, companyId: p.id, tone: 'good' });
    toast(w, `${who.charAt(0).toUpperCase()}${who.slice(1)} can't stop playing ${g.title}`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'Their fans are buying it by the thousand.' });
    return true;
  });
  if (hits.length && ready(w, 'npc')) options.push(() => {
    const g = pick(w, hits);
    const npc = pick(w, NPCS);
    boost(g, 1.25, 21, w.day);
    w.player.licenses.push({ id: newId(w, 'lic'), label: `${npc} plushies`, monthly: Math.round(Math.max(1500, g.active * 0.02) / 100) * 100, monthsLeft: 6 });
    mark(w, 'npc');
    toast(w, `${npc} from ${g.title} is the internet's new favourite meme`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'A toy company already wants to make plushies (6 months of licensing).' });
    return true;
  });
  const builders = hits.filter((g) => g.genre === 'sandbox' || g.genre === 'simulation' || g.genre === 'strategy');
  if (builders.length && ready(w, 'computer')) options.push(() => {
    const g = pick(w, builders);
    boost(g, 1.25, 14, w.day);
    g.goodwill += 1;
    mark(w, 'computer');
    toast(w, `Someone built a working computer inside ${g.title}. It runs ${g.title}.`, 'good', { category: 'game', link: { route: 'game', id: g.id } });
    return true;
  });
  if (hits.length && ready(w, 'grandma')) options.push(() => {
    const g = pick(w, hits);
    boost(g, 1.2, 14, w.day);
    g.goodwill += 3;
    mark(w, 'grandma');
    toast(w, `A 92-year-old grandma streaming ${g.title} is the internet's new hero`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'She just beat the final boss without taking damage.' });
    return true;
  });
  const classics = gamesOf(w, p.id).filter((g) => g.releaseDay !== null && w.day - g.releaseDay > 700 && g.criticScore >= 70);
  if (classics.length && ready(w, 'petition', 600)) options.push(() => {
    const g = pick(w, classics);
    const ip = w.ips[g.ipId];
    if (ip) ip.fans *= 1.2;
    mark(w, 'petition');
    toast(w, `${randInt(w, 40, 900)}K fans signed a petition for a ${g.title} sequel`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'Franchise fans +20%. A sequel or remaster would sell well.' });
    return true;
  });
  if (devs.length && ready(w, 'cat')) options.push(() => {
    const g = pick(w, devs);
    const fixed = Math.max(1, Math.round(g.bugs * 0.2));
    g.bugs *= 0.8;
    mark(w, 'cat');
    toast(w, `The office cat walked across a keyboard and somehow fixed ${fixed} bugs in ${g.title}`, 'good', { category: 'studio', link: { route: 'game', id: g.id }, body: 'Nobody can explain it. The cat has been promoted.' });
    return true;
  });
  if (devs.length && ready(w, 'typo')) options.push(() => {
    const g = pick(w, devs);
    g.hype = Math.min(1400, g.hype + 30);
    mark(w, 'typo');
    toast(w, `A typo in the ${g.title} trailer ("Pre-oder now!") is trending worldwide`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'There is no such thing as bad publicity: +30 hype.' });
    return true;
  });
  if (hits.length && ready(w, 'cosplay')) options.push(() => {
    const g = pick(w, hits);
    const ip = w.ips[g.ipId];
    if (ip) ip.fans *= 1.1;
    const gained = bumpRep(p, 1);
    mark(w, 'cosplay');
    toast(w, `A ${g.title} cosplay just won the world championship`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: `Franchise fans +10%, studio ${gained}.` });
    return true;
  });
  if (hits.length && ready(w, 'mods')) options.push(() => {
    const g = pick(w, hits);
    const twist = pick(w, ['a dating sim', 'a cooking show', 'a horror game', 'a racing game with shopping trolleys', `a ${TOPICS[g.topic]?.name.toLowerCase() ?? 'cat'} simulator`]);
    g.freshness = Math.min(1.2, g.freshness + 0.1);
    g.goodwill += 1.5;
    mark(w, 'mods');
    toast(w, `Modders turned ${g.title} into ${twist}`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'Old players are coming back to try it. Freshness +10%.' });
    return true;
  });
  // choices
  if (hits.length && ready(w, 'glitch')) options.push(() => {
    const g = pick(w, hits);
    const glitch = pick(w, GLITCHES);
    mark(w, 'glitch');
    pushDecision(w, {
      kind: 'memeGlitch',
      title: `Players found ${glitch} in ${g.title} and it's a meme`,
      body: `Clips of ${glitch} are everywhere. Purists want it fixed. Everyone else wants more of it.`,
      options: [
        { id: 'feature', label: "It's a feature now", description: 'Lean into it: big viral boost and goodwill.' },
        { id: 'patch', label: 'Patch it out', description: 'Fewer bugs, but the internet will be sad.' },
      ],
      data: { gameId: g.id },
      expiresDay: w.day + 21,
      defaultOption: 'feature',
    });
    return true;
  });
  const rival = w.player.rivalId ? w.companies[w.player.rivalId] : null;
  if (rival && rival.status === 'active' && hits.length && ready(w, 'diss')) options.push(() => {
    const g = pick(w, hits);
    const line = pick(w, DISSES);
    mark(w, 'diss');
    pushDecision(w, {
      kind: 'memeDiss',
      title: `${rival.ceo} of ${rival.name} called ${g.title} "${line}"`,
      body: 'The quote is everywhere. Your fans are furious, and the internet wants to see you respond.',
      options: [
        { id: 'clap', label: 'Clap back on social media', description: 'High risk, high reward. Could go viral, could backfire.' },
        { id: 'high', label: 'Take the high road', description: `${fanChange(p, 1)}. Classy.` },
        { id: 'ad', label: 'Turn it into an ad campaign', description: 'Spend on a cheeky campaign: hype for every game in development.' },
      ],
      data: { gameId: g.id, rivalId: rival.id, cost: Math.round(Math.max(10000, p.cash * 0.01) / 1000) * 1000 },
      expiresDay: w.day + 21,
      defaultOption: 'high',
    });
    return true;
  });

  if (!options.length) return;
  pick(w, options)();
}

export function resolveMeme(w: World, ev: DecisionEvent, optionId: string): boolean {
  const p = playerCompany(w);
  const g = ev.data.gameId ? w.games[String(ev.data.gameId)] : undefined;
  switch (ev.kind) {
    case 'memeGlitch':
      if (!g) return true;
      if (optionId === 'feature') {
        boost(g, 1.45, 21, w.day);
        g.goodwill += 2;
        addXp(w, 30);
      } else {
        g.bugs *= 0.8;
        g.goodwill -= 1;
      }
      return true;
    case 'memeDiss': {
      const rival = w.companies[String(ev.data.rivalId)];
      if (optionId === 'clap') {
        if (chance(w, 0.55)) {
          if (g) boost(g, 1.35, 21, w.day);
          if (rival) rival.reputation = Math.max(0, rival.reputation - 2);
          addXp(w, 40);
          toast(w, 'Your clap-back went viral. The internet picked your side.', 'good', { category: 'industry' });
        } else {
          toast(w, `Your clap-back aged badly: ${bumpRep(p, -2)}.`, 'bad', { category: 'industry' });
        }
      } else if (optionId === 'ad') {
        spend(p, 'marketing', Number(ev.data.cost));
        for (const x of gamesOf(w, p.id)) if (x.status === 'development') x.hype = Math.min(1400, x.hype + 35);
      } else {
        p.reputation = clamp(p.reputation + 1, 0, 100);
      }
      return true;
    }
  }
  return false;
}

