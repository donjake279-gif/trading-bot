// Macro-economy, random world events, player decisions, awards and auctions.
import { DIFFICULTIES, GENRES, GENRE_IDS, MAX_LIFELINES, PLATFORMS, PLATFORM_IDS, PLAYER_GRACE_DAYS, ROLES, SCOPE_IDS } from './constants';
import { amortizedPayment, debtOf, monthlyBurn, profitTTM, revenueTTM, takeLoan } from './finance';
import { ratingOf } from './market';
import { personName } from './names';
import { opportunitiesDaily, resolveOpportunity } from './opportunities';
import { resolveMeme } from './memes';
import { addXp } from './progression';
import { chance, pick, randInt, randNormal, randRange, weightedPick } from './rng';
import { acquireCompany, founderStake, marketCap } from './stocks';
import type { DecisionEvent, Game, GenreId, World } from './types';
import { activeCompanies, clamp, dayToDate, markGamesDirty, newId, playerCompany, pushNews, pushPoint, toast, yearOf } from './util';

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

function severity(w: World): number {
  return DIFFICULTIES[w.difficulty].eventSeverity;
}

// ------------------------------------------------------------ macro

export function macroDay(w: World): void {
  const m = w.market;
  for (const gid of GENRE_IDS) {
    const gs = m.genres[gid];
    if (chance(w, 1 / 220)) gs.target = clamp(Math.exp(randNormal(w, 0, 0.25)), 0.55, 1.7);
    gs.trend = clamp(gs.trend + (gs.target - gs.trend) * 0.008 + randNormal(w, 0, 0.003), 0.35, 2.2);
  }
  for (const pid of PLATFORM_IDS) {
    const ps = m.platforms[pid];
    ps.users *= 1 + ps.growth / 365;
    const mature = PLATFORMS[pid].growth < 0.05 ? 0.02 : 0.04;
    ps.growth += (mature - ps.growth) * 0.0006;
  }
  // consumer sentiment
  let target = m.sentimentTarget;
  for (const e of m.effects) if (e.kind === 'sentiment') target *= e.mult;
  m.sentiment = clamp(m.sentiment + (target - m.sentiment) * 0.01 + randNormal(w, 0, 0.002), 0.55, 1.45);
  // expire effects
  const before = m.effects.length;
  m.effects = m.effects.filter((e) => e.until > w.day);
  if (m.effects.length !== before) {
    // nothing extra; effects simply lapse
  }
  if (dayToDate(w.day).getUTCDate() === 1) {
    for (const gid of GENRE_IDS) pushPoint(m.genres[gid].history, w.day, m.genres[gid].trend, 160);
    for (const pid of PLATFORM_IDS) pushPoint(m.platforms[pid].history, w.day, m.platforms[pid].users, 160);
    m.baseRate = clamp(m.baseRate + randNormal(w, 0, 0.0025) + (0.045 - m.baseRate) * 0.03, 0.01, 0.1);
  }
}

/** A breakout hit nudges its genre's popularity up: crazes emerge from success. */
export function hitFeedback(w: World, g: Game): void {
  const gs = w.market.genres[g.genre];
  gs.target = clamp(gs.target + 0.12 * g.breakout, 0.5, 2.0);
  const c = w.companies[g.companyId];
  pushNews(w, {
    kind: 'industry',
    title: `${g.title} is a phenomenon — ${GENRES[g.genre].name} games surge in popularity`,
    body: `${c.name}'s surprise hit is drawing players from every corner of the market.`,
    companyId: c.id,
    gameId: g.id,
    tone: 'major',
  });
}

// ------------------------------------------------------------ world events

export function randomEvents(w: World): void {
  const sev = severity(w);
  const m = w.market;
  const day = w.day;

  if (chance(w, 0.0025)) {
    const g = pick(w, GENRE_IDS);
    const mult = randRange(w, 1.35, 1.7);
    m.effects.push({ id: newId(w, 'e'), kind: 'genreBoost', genre: g, mult, until: day + randInt(w, 120, 300), label: `${GENRES[g].name} craze` });
    pushNews(w, { kind: 'industry', title: `${GENRES[g].name} craze sweeps the gaming world`, body: 'Streamers, influencers and players all want more. Interest in the genre is surging.', tone: 'major' });
  }
  if (chance(w, 0.002)) {
    const g = pick(w, GENRE_IDS);
    m.effects.push({ id: newId(w, 'e'), kind: 'genreBoost', genre: g, mult: randRange(w, 0.55, 0.75), until: day + randInt(w, 120, 240), label: `${GENRES[g].name} fatigue` });
    pushNews(w, { kind: 'industry', title: `Players burned out on ${GENRES[g].name} games`, body: 'Analysts report a sharp fall in interest after a glut of releases.', tone: 'bad' });
  }
  if (chance(w, 0.0006 * sev) && !m.effects.some((e) => e.kind === 'sentiment' && e.mult < 1)) {
    m.effects.push({ id: newId(w, 'e'), kind: 'sentiment', mult: randRange(w, 0.74, 0.84), until: day + randInt(w, 300, 520), label: 'Recession' });
    m.regime = 'bear';
    m.index *= 0.88;
    pushNews(w, { kind: 'market', title: 'Global recession hits: consumers slash entertainment spending', body: 'Expect weaker sales and tighter credit. Investors are fleeing risk.', tone: 'major' });
  }
  if (chance(w, 0.0008)) {
    m.effects.push({ id: newId(w, 'e'), kind: 'sentiment', mult: randRange(w, 1.08, 1.18), until: day + randInt(w, 200, 400), label: 'Economic boom' });
    pushNews(w, { kind: 'market', title: 'Economic boom lifts consumer spending on games', tone: 'good' });
  }
  if (chance(w, 0.0004 * sev)) {
    const hit = randRange(w, 0.68, 0.82);
    m.index *= hit;
    for (const c of activeCompanies(w)) if (c.isPublic) c.price *= hit * randRange(w, 0.92, 1.05);
    m.regime = 'bear';
    pushNews(w, { kind: 'market', title: `Market crash! Gaming index plunges ${Math.round((1 - hit) * 100)}%`, body: 'Panic selling wipes billions off studio valuations in a single session.', tone: 'major' });
  }
  if (chance(w, 0.0006)) {
    m.platforms.console.users *= 1.08;
    m.effects.push({ id: newId(w, 'e'), kind: 'platformBoost', platform: 'console', mult: 1.15, until: day + 365, label: 'Next-gen console launch' });
    pushNews(w, { kind: 'industry', title: 'A new console generation launches to record pre-orders', body: 'Console audiences swell as players upgrade.', tone: 'major' });
  }
  if (chance(w, 0.0005)) {
    const p = pick(w, ['vr', 'cloud', 'mobile', 'handheld'] as const);
    m.platforms[p].growth += randRange(w, 0.08, 0.2);
    pushNews(w, { kind: 'industry', title: `${PLATFORMS[p].name} breakthrough: new hardware drives a wave of adoption`, tone: 'good' });
  }
  if (chance(w, 0.0006 * sev) && !m.effects.some((e) => e.kind === 'regulation')) {
    m.effects.push({ id: newId(w, 'e'), kind: 'regulation', mult: 0.55, until: day + randInt(w, 400, 700), label: 'Loot box regulation' });
    for (const c of activeCompanies(w)) {
      const aggressive = Object.values(w.games).some((g) => g.companyId === c.id && g.status === 'released' && g.monetization === 'f2pAggressive');
      if (aggressive) c.reputation = Math.max(0, c.reputation - 4);
    }
    pushNews(w, { kind: 'industry', title: 'Lawmakers crack down on loot boxes', body: 'Aggressive free-to-play monetization revenue is expected to fall sharply.', tone: 'major' });
  }
  if (chance(w, 0.0003)) {
    m.effects.push({ id: newId(w, 'e'), kind: 'surge', mult: 1.22, until: day + randInt(w, 120, 220), label: 'Gaming surge' });
    pushNews(w, { kind: 'industry', title: 'Gaming hours hit record highs as people stay home', tone: 'good' });
  }
  if (chance(w, 0.0008)) {
    const old = m.titanRoyalty;
    m.titanRoyalty = clamp(old + pick(w, [-0.02, -0.01, 0.01, 0.02, 0.03]), 0.02, 0.1);
    if (m.titanRoyalty !== old) {
      pushNews(w, { kind: 'industry', title: `Titan Engine ${m.titanRoyalty > old ? 'raises' : 'cuts'} its royalty to ${Math.round(m.titanRoyalty * 100)}%`, body: m.titanRoyalty > old ? 'Developers are furious.' : 'Developers cheer the change.', tone: m.titanRoyalty > old ? 'bad' : 'good' });
    }
  }

  viralEvent(w);
  scandalEvent(w);
  playerEvents(w);
}

function viralEvent(w: World): void {
  if (!chance(w, 0.022)) return;
  const pool = Object.values(w.games).filter((g) => g.status === 'released' && g.releaseDay !== null && w.day - g.releaseDay < 900 && w.day > g.viralUntil);
  if (pool.length === 0) return;
  const g = weightedPick(
    w,
    pool,
    pool.map((x) => Math.pow(ratingOf(x), 3) / Math.sqrt(1 + x.active / 20000) * (w.companies[x.companyId].isPlayer ? 2.5 : 1)),
  );
  g.viralMult = randRange(w, 1.8, 3.6);
  g.viralUntil = w.day + randInt(w, 20, 45);
  const c = w.companies[g.companyId];
  const reason = pick(w, [
    'a top streamer binged it live',
    'a clip went viral on social media',
    'a celebrity called it their favourite game',
    'it was featured in a hit TV show',
    'a speedrunning community discovered it',
  ]);
  pushNews(w, { kind: c.isPlayer ? 'player' : 'industry', title: `${g.title} goes viral after ${reason}`, companyId: c.id, gameId: g.id, tone: c.isPlayer ? 'good' : 'neutral' });
  if (c.isPlayer) toast(w, `${g.title} is going viral!`, 'good');
}

function scandalEvent(w: World): void {
  if (!chance(w, 0.006 * severity(w))) return;
  const pool = activeCompanies(w).filter((c) => !c.isPlayer && c.headcount > 20);
  if (pool.length === 0) return;
  const c = weightedPick(
    w,
    pool,
    pool.map((x) => Math.log10(x.headcount) * (x.strategy === 'monetizer' || x.strategy === 'aggressiveGrowth' ? 2 : 1)),
  );
  const kind = pick(w, ['crunch', 'toxic', 'breach', 'ceo', 'lootbox']);
  const titles: Record<string, string> = {
    crunch: `Report exposes brutal crunch culture at ${c.name}`,
    toxic: `${c.name} rocked by toxic workplace allegations`,
    breach: `${c.name} suffers massive player data breach`,
    ceo: `${c.name} CEO ${c.ceo} resigns amid controversy`,
    lootbox: `${c.name} accused of predatory loot box practices`,
  };
  const repHit = randRange(w, 6, 18) * severity(w);
  c.reputation = Math.max(0, c.reputation - repHit);
  if (c.isPublic) c.price *= randRange(w, 0.72, 0.9);
  if (kind === 'ceo') c.ceo = personName(w);
  if (kind === 'toxic' || kind === 'crunch') c.talent = Math.max(15, c.talent - randRange(w, 1, 4));
  pushNews(w, { kind: 'industry', title: titles[kind], body: `Reputation takes a beating${c.isPublic ? ' and the stock tumbles' : ''}.`, companyId: c.id, tone: 'bad' });
}

// ------------------------------------------------------------ player decisions

export function pushDecision(w: World, ev: Omit<DecisionEvent, 'id' | 'day'>): void {
  if (w.pendingEvents.some((e) => e.kind === ev.kind)) return;
  // the game never pauses for decisions, so give the player real time to answer
  const expiresDay = Math.max(ev.expiresDay, w.day + 21);
  w.pendingEvents.push({ ...ev, expiresDay, id: newId(w, 'd'), day: w.day });
  toast(w, ev.title, 'major', { category: 'offer', link: { route: 'inbox' }, body: 'Decision waiting in your inbox.' });
}

function playerEvents(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active' || w.player.gameOver) return;
  const emps = w.player.employees.filter((e) => !e.isFounder);

  // publisher deal
  const devGames = Object.values(w.games).filter((g) => g.companyId === p.id && g.status === 'development' && g.publisherCut === 0);
  if (devGames.length && p.reputation < 45 && chance(w, 0.003)) {
    const g = pick(w, devGames);
    const amount = Math.round(Math.max(15000, g.workRequired * 220 + g.budget * 0.6) / 1000) * 1000;
    const cut = pick(w, [0.25, 0.3, 0.35, 0.4]);
    pushDecision(w, {
      kind: 'publisher',
      title: 'A publisher wants to fund your game',
      body: `A mid-size publisher offers ${fmt(amount)} upfront for ${g.title}, in exchange for ${Math.round(cut * 100)}% of its revenue forever. They'll also add some marketing muscle (+60 hype).`,
      options: [
        { id: 'accept', label: `Take ${fmt(amount)}`, description: `Cash now, ${Math.round(cut * 100)}% revenue share for life.` },
        { id: 'decline', label: 'Stay independent', description: 'Keep 100% of the upside.' },
      ],
      data: { gameId: g.id, amount, cut },
      expiresDay: w.day + 14,
    });
  }

  // acquisition offer for a private player company
  if (!p.isPublic && p.valuation > 4e6 && chance(w, 0.0012)) {
    const buyers = activeCompanies(w).filter((c) => !c.isPlayer && !c.parentId && c.cash > p.valuation * 1.6);
    if (buyers.length) {
      const buyer = pick(w, buyers);
      const offer = Math.round(p.valuation * randRange(w, 1.2, 1.7));
      const payout = offer * founderStake(p);
      pushDecision(w, {
        kind: 'buyout',
        title: `${buyer.name} wants to buy your company`,
        body: `${buyer.name} offers ${fmt(offer)} for ${p.name}. Your stake would be worth ${fmt(payout)}. Accepting ends your run as a successful exit.`,
        options: [
          { id: 'accept', label: `Sell for ${fmt(offer)}`, description: 'Cash out. The game ends with your exit.' },
          { id: 'decline', label: 'Decline', description: 'Keep building your empire.' },
        ],
        data: { buyerId: buyer.id, offer },
        expiresDay: w.day + 14,
      });
    }
  }

  // hostile takeover for a public player company with weak founder control
  if (p.isPublic && founderStake(p) < 0.5 && chance(w, 0.0012 * severity(w))) {
    const cap = marketCap(p);
    const raiders = activeCompanies(w).filter((c) => !c.isPlayer && !c.parentId && c.cash > cap * 1.35);
    if (raiders.length) {
      const raider = pick(w, raiders);
      const premium = randRange(w, 1.25, 1.45);
      const pillCost = Math.round(cap * 0.06);
      pushDecision(w, {
        kind: 'takeover',
        title: `HOSTILE TAKEOVER: ${raider.name} bids for ${p.name}`,
        body: `${raider.name} is offering shareholders $${(p.price * premium).toFixed(2)}/share (${Math.round((premium - 1) * 100)}% premium). You control only ${Math.round(founderStake(p) * 100)}% of the votes.`,
        options: [
          { id: 'accept', label: 'Recommend the deal', description: 'Sell your stake at the premium. The game ends as an exit.' },
          { id: 'pill', label: `Poison pill (${fmt(pillCost)})`, description: `Costly defence. Success odds ~${Math.round(clamp(0.45 + founderStake(p) + p.boardConfidence / 250, 0.2, 0.95) * 100)}%.`, disabled: p.cash < pillCost },
          { id: 'fight', label: 'Fight with shareholder letters', description: `Free, but odds ~${Math.round(clamp(founderStake(p) * 1.1 + p.boardConfidence / 300, 0.05, 0.85) * 100)}%. Losing means you are taken over.` },
        ],
        data: { raiderId: raider.id, premium, pillCost },
        expiresDay: w.day + 30,
        defaultOption: 'lapse',
      });
    }
  }

  // crunch scandal
  const crunching = Object.values(w.games).filter((g) => g.companyId === p.id && g.status === 'development' && g.crunch && g.crunchDays > 30);
  if (crunching.length && chance(w, 0.008 * severity(w))) {
    p.reputation = Math.max(0, p.reputation - 10);
    for (const e of w.player.employees) if (!e.traits.includes('crunchProof')) e.morale = Math.max(0, e.morale - 15);
    if (p.isPublic) p.price *= 0.88;
    p.boardConfidence = Math.max(0, p.boardConfidence - 10);
    pushNews(w, { kind: 'player', title: `Exposé: crunch culture at ${p.name}`, body: 'Journalists report months of forced overtime. Reputation and morale suffer.', companyId: p.id, tone: 'bad' });
    toast(w, 'Crunch scandal hits your studio!', 'bad', { category: 'studio', body: 'Reputation -10 and the team is demoralised.' });
  }

  // predatory monetization aimed at kids
  const predatory = Object.values(w.games).some((g) => g.companyId === p.id && g.status === 'released' && g.monetization === 'f2pAggressive' && g.audience === 'kids');
  if (predatory && chance(w, 0.006 * severity(w))) {
    p.reputation = Math.max(0, p.reputation - 12);
    pushNews(w, { kind: 'player', title: `Parents outraged by ${p.name}'s loot boxes in kids' games`, companyId: p.id, tone: 'bad' });
    toast(w, 'Loot box outrage damages your reputation', 'bad', { category: 'game', body: 'Aggressive monetization in a kids game. Reputation -12.' });
  }

  // raise request
  if (emps.length >= 2 && chance(w, 0.0025)) {
    const e = pick(w, emps);
    if (e.morale < 75) {
      const raise = Math.round(e.salary * 0.15);
      pushDecision(w, {
        kind: 'raise',
        title: `${e.name} asks for a raise`,
        body: `${e.name} (${ROLES[e.role].name}, skill ${Math.round(e.skill)}) feels underpaid and asks for +15% (${fmt(raise)}/mo).`,
        options: [
          { id: 'accept', label: 'Grant the raise', description: 'Morale +25.' },
          { id: 'decline', label: 'Decline', description: 'Morale -20. They might start looking elsewhere.' },
        ],
        data: { employeeId: e.id, raise },
        expiresDay: w.day + 10,
      });
    }
  }

  // patent troll
  if (revenueTTM(p) > 1e6 && chance(w, 0.0007 * severity(w))) {
    const settle = Math.round(clamp(revenueTTM(p) * 0.02, 50000, 25e6));
    pushDecision(w, {
      kind: 'lawsuit',
      title: 'Patent troll sues your company',
      body: `Ludicrous Patents LLC claims your games infringe a patent on "interactive entertainment software". They'll settle for ${fmt(settle)}.`,
      options: [
        { id: 'settle', label: `Settle (${fmt(settle)})`, description: 'Make it go away.' },
        { id: 'fight', label: 'Fight in court', description: `60% chance you win and pay only legal fees (${fmt(settle * 0.2)}); 40% chance you pay ${fmt(settle * 2.5)}.` },
      ],
      data: { settle },
      expiresDay: w.day + 14,
    });
  }

  opportunitiesDaily(w);
}

export function resolveDecision(w: World, eventId: string, optionId: string): void {
  const idx = w.pendingEvents.findIndex((e) => e.id === eventId);
  if (idx < 0) return;
  const ev = w.pendingEvents[idx];
  if (!decisionOptionEnabled(w, ev, optionId)) return;
  w.pendingEvents.splice(idx, 1);
  const p = playerCompany(w);
  const d = ev.data;
  switch (ev.kind) {
    case 'publisher': {
      const g = w.games[String(d.gameId)];
      if (optionId === 'accept' && g && g.status === 'development') {
        p.cash += Number(d.amount);
        p.ledger.other += Number(d.amount);
        g.publisherCut = Number(d.cut);
        g.hype += 60;
        pushNews(w, { kind: 'player', title: `${p.name} signs a publishing deal for ${g.title}`, companyId: p.id, gameId: g.id, tone: 'neutral' });
      }
      break;
    }
    case 'buyout': {
      if (optionId === 'accept') {
        const buyer = w.companies[String(d.buyerId)];
        const offer = Number(d.offer);
        if (buyer && buyer.cash >= offer) {
          const payout = offer * founderStake(p);
          acquireCompany(w, buyer, p, offer);
          w.player.gameOver = {
            reason: 'sold',
            day: w.day,
            title: `You sold ${p.name} to ${buyer.name}`,
            body: `A successful exit! Your stake paid out ${fmt(payout)}.`,
            netWorth: payout,
          };
        }
      }
      break;
    }
    case 'takeover': {
      const raider = w.companies[String(d.raiderId)];
      if (optionId === 'lapse') {
        pushNews(w, { kind: 'player', title: `${raider?.name ?? 'A rival'}'s bid for ${p.name} lapses without shareholder support`, companyId: p.id, tone: 'good' });
        break;
      }
      const premium = Number(d.premium);
      const price = p.price * premium * p.shares;
      const lose = () => {
        if (!raider) return;
        const payout = founderStake(p) * price;
        acquireCompany(w, raider, p, price);
        w.player.gameOver = {
          reason: 'takeover',
          day: w.day,
          title: `${raider.name} completes a hostile takeover of ${p.name}`,
          body: `Shareholders sold out from under you. Your remaining stake paid ${fmt(payout)}, but your empire now belongs to someone else.`,
          netWorth: payout,
        };
      };
      if (optionId === 'accept') {
        if (!raider) break;
        const payout = founderStake(p) * price;
        acquireCompany(w, raider, p, price);
        w.player.gameOver = { reason: 'sold', day: w.day, title: `You sold ${p.name} to ${raider.name}`, body: `You negotiated a premium exit worth ${fmt(payout)} for your stake.`, netWorth: payout };
      } else if (optionId === 'pill') {
        p.cash -= Number(d.pillCost);
        p.ledger.misc += Number(d.pillCost);
        if (chance(w, clamp(0.45 + founderStake(p) + p.boardConfidence / 250, 0.2, 0.95))) {
          pushNews(w, { kind: 'player', title: `${p.name} fends off ${raider?.name ?? 'raider'}'s takeover bid`, companyId: p.id, tone: 'good' });
          p.price *= 0.95;
        } else lose();
      } else {
        if (chance(w, clamp(founderStake(p) * 1.1 + p.boardConfidence / 300, 0.05, 0.85))) {
          pushNews(w, { kind: 'player', title: `Shareholders reject ${raider?.name ?? 'raider'}'s hostile bid for ${p.name}`, companyId: p.id, tone: 'good' });
        } else lose();
      }
      break;
    }
    case 'raise': {
      const e = w.player.employees.find((x) => x.id === d.employeeId);
      if (!e) break;
      if (optionId === 'accept') {
        e.salary += Number(d.raise);
        e.morale = Math.min(100, e.morale + 25);
      } else e.morale = Math.max(0, e.morale - 20);
      break;
    }
    case 'lifeline': {
      if (optionId === 'decline') break;
      const amount = Number(d.amount);
      w.player.lifelinesUsed += 1;
      if (optionId === 'equity') {
        const equity = Number(d.equity);
        const newShares = (p.shares * equity) / (1 - equity);
        p.shares += newShares;
        p.investorShares += newShares;
        p.cash += amount;
        if (p.boardConfidence >= 100) p.boardConfidence = 65;
        pushNews(w, { kind: 'finance', title: `An angel investor rescues ${p.name} with ${fmt(amount)}`, body: `${Math.round(equity * 100)}% equity.`, companyId: p.id, tone: 'good' });
      } else {
        takeLoan(w, p, amount, 36, Number(d.apr));
        pushNews(w, { kind: 'finance', title: `${p.name} survives on an emergency loan of ${fmt(amount)}`, companyId: p.id, tone: 'good' });
      }
      toast(w, 'Lifeline accepted: you are back in business', 'good', { category: 'finance', link: { route: 'finance' } });
      break;
    }
    case 'lawsuit': {
      const settle = Number(d.settle);
      let cost = settle;
      if (optionId === 'fight') cost = chance(w, 0.6) ? settle * 0.2 : settle * 2.5;
      p.cash -= cost;
      p.ledger.misc += cost;
      pushNews(w, { kind: 'player', title: optionId === 'fight' ? (cost < settle ? 'Court throws out patent troll lawsuit' : 'Court rules against you in patent case') : 'Patent lawsuit settled', body: `Cost: ${fmt(cost)}.`, companyId: p.id, tone: cost < settle ? 'good' : 'bad' });
      break;
    }
    default:
      if (!resolveOpportunity(w, ev, optionId)) resolveMeme(w, ev, optionId);
  }
}

/** Cost-gated options are disabled when offered without the cash; re-check against today's cash. */
export function decisionOptionEnabled(w: World, ev: DecisionEvent, optionId: string): boolean {
  const opt = ev.options.find((o) => o.id === optionId);
  if (!opt?.disabled) return true;
  const d = ev.data;
  const cost = Number(d.fee ?? d.cost ?? d.bounty ?? d.amount ?? d.price ?? d.pillCost ?? (optionId === 'retreat' ? d.retreat : optionId === 'bonus' ? d.bonus : NaN));
  return Number.isFinite(cost) && playerCompany(w).cash >= cost;
}

export function expireDecisions(w: World): void {
  const expired = w.pendingEvents.filter((e) => e.expiresDay <= w.day);
  for (const ev of expired) {
    const fallback = ev.defaultOption ?? (ev.options.find((o) => o.id === 'decline' || o.id === 'settle') ?? ev.options[ev.options.length - 1]).id;
    resolveDecision(w, ev.id, fallback);
  }
}

// ------------------------------------------------------------ player solvency & board

export function playerSolvency(w: World): void {
  const p = playerCompany(w);
  if (w.player.gameOver) return;
  if (p.cash < 0) {
    p.insolventDays += 1;
    const left = PLAYER_GRACE_DAYS - p.insolventDays;
    if ((p.insolventDays === 14 || p.insolventDays === 60) && w.player.lifelinesUsed < MAX_LIFELINES) offerLifeline(w);
    if (p.insolventDays === 1 || left === 30 || left === 14 || left === 7 || left === 3) {
      pushNews(w, { kind: 'player', title: `Cash is negative! ${left} days until bankruptcy`, body: 'Take a loan, raise funding, sell assets or cut costs now.', companyId: p.id, tone: 'bad' });
      toast(w, `Cash is negative: ${left} days until bankruptcy`, 'bad', { category: 'finance', link: { route: 'finance' }, body: 'Take a loan, raise funding, sell assets or cut costs.' });

    }
    if (p.insolventDays > PLAYER_GRACE_DAYS) {
      p.status = 'bankrupt';
      p.endDay = w.day;
      w.player.gameOver = {
        reason: 'bankrupt',
        day: w.day,
        title: `${p.name} is bankrupt`,
        body: `After ${PLAYER_GRACE_DAYS} days in the red with debts of ${fmt(debtOf(p) - p.cash)}, creditors seized everything. You lost it all.`,
        netWorth: 0,
      };
      pushNews(w, { kind: 'player', title: `${p.name} files for bankruptcy`, companyId: p.id, tone: 'major' });
    }
  } else {
    p.insolventDays = 0;
  }
}

/** How much a rescue needs to be: clear the hole plus a few months of runway. */
export function lifelineAmount(w: World): number {
  const p = playerCompany(w);
  return Math.round(Math.max(30000, -p.cash + monthlyBurn(w, p) * 4) / 1000) * 1000;
}

function offerLifeline(w: World): void {
  const p = playerCompany(w);
  const amount = lifelineAmount(w);
  const equity = p.isPublic ? 0.1 : 0.15;
  const apr = w.market.baseRate + 0.12;
  pushDecision(w, {
    kind: 'lifeline',
    title: 'An angel investor offers a lifeline',
    body: `${p.name} has been in the red for two weeks. A veteran of the industry believes in you and offers ${fmt(amount)} to keep the lights on. Take it as equity, or as an emergency loan your bank would never give you.`,
    options: [
      { id: 'equity', label: `Take ${fmt(amount)} for ${Math.round(equity * 100)}% of the company`, description: 'No repayments. Your ownership stake shrinks.' },
      { id: 'loan', label: `Borrow ${fmt(amount)} at ${(apr * 100).toFixed(1)}% over 3 years`, description: `Keep full ownership. About ${fmt(amortizedPayment(amount, apr, 36))}/month in repayments.` },
      { id: 'decline', label: 'Decline and fix it myself', description: `You have ${PLAYER_GRACE_DAYS - p.insolventDays} days before bankruptcy.` },
    ],
    data: { amount, equity, apr },
    expiresDay: w.day + 14,
    // the game never pauses, so an unanswered lifeline quietly becomes the loan
    defaultOption: 'loan',
  });
}

export function boardMonthly(w: World): void {
  const p = playerCompany(w);
  if (w.player.gameOver) return;
  const stake = founderStake(p);
  if (stake >= 0.999) {
    p.boardConfidence = 100;
    return;
  }
  const rev = revenueTTM(p);
  const margin = rev > 0 ? profitTTM(p) / rev : -0.5;
  let stockPerf = 0;
  if (p.isPublic && p.priceHistory.length > 5) {
    const old = p.priceHistory.find((pt) => pt[0] >= w.day - 90) ?? p.priceHistory[0];
    stockPerf = clamp((p.price / old[1] - 1) * 60, -25, 25);
  }
  const recent = p.monthly.slice(-3).reduce((s, m) => s + m.revenue, 0);
  const prior = p.monthly.slice(-6, -3).reduce((s, m) => s + m.revenue, 0);
  const growth = prior > 0 ? (recent > prior ? 8 : -8) : 0;
  const target = clamp(55 + 30 * clamp(margin, -1, 0.5) + stockPerf + growth + (p.cash < 0 ? -25 : 0) + (p.reputation - 40) * 0.2, 0, 100);
  p.boardConfidence = clamp(p.boardConfidence + (target - p.boardConfidence) * 0.35, 0, 100);
  if (p.boardConfidence < 30 && stake < 0.5) {
    toast(w, `Board confidence is down to ${Math.round(p.boardConfidence)}%`, 'bad', { category: 'finance', link: { route: 'finance' }, body: 'Below 15% the board can fire you. Improve profits or the share price.' });
    pushNews(w, { kind: 'player', title: `Board confidence in ${w.player.founderName} is collapsing (${Math.round(p.boardConfidence)}%)`, body: 'Improve profitability or the board may vote you out.', companyId: p.id, tone: 'bad' });
  }
  if (p.boardConfidence < 15 && stake < 0.5 && chance(w, 0.6)) {
    w.player.gameOver = {
      reason: 'ousted',
      day: w.day,
      title: `The board has fired ${w.player.founderName}`,
      body: `With only ${Math.round(stake * 100)}% of the company and investors losing faith, the board voted to replace you as CEO. Your shares remain, but your empire is no longer yours to run.`,
      netWorth: stake * p.valuation,
    };
    pushNews(w, { kind: 'player', title: `${p.name} ousts founder ${w.player.founderName}`, companyId: p.id, tone: 'major' });
  }
}

// ------------------------------------------------------------ awards

export function annualAwards(w: World): void {
  const year = yearOf(w.day);
  const eligible = Object.values(w.games).filter((g) => g.releaseDay !== null && yearOf(g.releaseDay) === year && g.status !== 'cancelled');
  if (eligible.length < 3) return;
  const byScore = (a: Game, b: Game) => b.criticScore - a.criticScore || b.peakCcu - a.peakCcu;
  // big categories weigh ambition and reach, not just the score
  const prestige = (g: Game) => g.criticScore + SCOPE_IDS.indexOf(g.scope) * 2 + Math.log10(10 + g.peakActive) * 1.5;
  const byPrestige = (a: Game, b: Game) => prestige(b) - prestige(a);
  const major = eligible.filter((g) => SCOPE_IDS.indexOf(g.scope) >= 2);
  const categories: [string, Game[]][] = [
    ['Game of the Year', (major.length ? major : eligible).sort(byPrestige)],
    ['Best Indie Game', eligible.filter((g) => ['tiny', 'small', 'medium'].includes(g.scope) && w.companies[g.companyId].headcount < 60).sort(byScore)],
    ['Best Multiplayer', major.filter((g) => g.multiplayer === 'online' || g.multiplayer === 'massive').sort(byPrestige)],
    ['Players\' Choice', [...eligible].sort((a, b) => b.userScore * Math.log10(10 + b.peakActive) - a.userScore * Math.log10(10 + a.peakActive))],
  ];
  const lines: string[] = [];
  for (const [cat, list] of categories) {
    const winner = list[0];
    if (!winner) continue;
    winner.awards.push(`${cat} ${year}`);
    winner.hype = Math.min(1400, winner.hype + 150);
    winner.viralMult = Math.max(winner.viralMult, 1.5);
    winner.viralUntil = Math.max(winner.viralUntil, w.day + 30);
    const c = w.companies[winner.companyId];
    c.reputation = Math.min(100, c.reputation + 5);
    w.awardsHistory.push({ year, category: cat, gameId: winner.id, title: winner.title, companyId: c.id });
    lines.push(`${cat}: ${winner.title} (${c.name})`);
    if (c.isPlayer) {
      toast(w, `${winner.title} wins ${cat}!`, 'good', { category: 'game', link: { route: 'game', id: winner.id } });
      addXp(w, 150);
    }
    for (const nominee of list.slice(1, 5)) {
      const nc = w.companies[nominee.companyId];
      nc.reputation = Math.min(100, nc.reputation + 1.5);
    }
  }
  pushNews(w, { kind: 'awards', title: `The ${year} Game Awards: ${categories[0][1][0]?.title ?? ''} wins Game of the Year`, body: lines.join(' · '), tone: 'major', gameId: categories[0][1][0]?.id });
}

// ------------------------------------------------------------ IP auctions

export function ipValue(w: World, ipId: string): number {
  const ip = w.ips[ipId];
  if (!ip) return 0;
  let v = ip.fans * 4;
  for (const gid of ip.games) {
    const g = w.games[gid];
    if (g && g.status === 'released') v += g.rev30 * 12 * 1.5;
  }
  return v;
}

export function resolveAuctions(w: World): void {
  for (const a of w.auctions) {
    if (a.resolved || a.endsDay > w.day) continue;
    a.resolved = true;
    const value = ipValue(w, a.ipId);
    for (const c of activeCompanies(w)) {
      if (c.isPlayer || c.parentId) continue;
      if (c.cash < a.minBid * 3 || !chance(w, 0.35)) continue;
      a.bids[c.id] = Math.max(a.minBid, value * randRange(w, 0.5, 1.25));
    }
    let best: string | null = null;
    let bestBid = 0;
    for (const id in a.bids) {
      const bidder = w.companies[id];
      if (!bidder || bidder.status !== 'active' || bidder.cash < a.bids[id]) continue;
      if (a.bids[id] > bestBid) {
        best = id;
        bestBid = a.bids[id];
      }
    }
    const ip = w.ips[a.ipId];
    if (!best || !ip) {
      for (const gid of ip?.games ?? []) {
        const g = w.games[gid];
        if (g && g.status === 'released') {
          g.status = 'shutdown';
          g.shutdownDay = w.day;
          g.active = 0;
          g.ccu = 0;
        }
      }
      continue;
    }
    const winner = w.companies[best];
    winner.cash -= bestBid;
    winner.ledger.misc += bestBid;
    ip.companyId = winner.id;
    for (const gid of ip.games) {
      const g = w.games[gid];
      if (g) g.companyId = winner.id;
    }
    markGamesDirty(w);
    pushNews(w, {
      kind: 'finance',
      title: `${winner.name} wins the auction for the ${a.ipName} IP (${fmt(bestBid)})`,
      companyId: winner.id,
      tone: winner.isPlayer ? 'good' : 'neutral',
    });
    if (winner.isPlayer) toast(w, `You won the ${a.ipName} IP!`, 'good');
  }
  w.auctions = w.auctions.filter((a) => !a.resolved || w.day - a.endsDay < 60);
}

/** Pick a genre currently trending hottest (used by UI hints and events). */
export function hottestGenre(w: World): GenreId {
  let best: GenreId = 'fps';
  let bv = -1;
  for (const g of GENRE_IDS) {
    if (w.market.genres[g].trend > bv) {
      bv = w.market.genres[g].trend;
      best = g;
    }
  }
  return best;
}
