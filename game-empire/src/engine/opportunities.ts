// Inbox opportunities and dilemmas: streamers, storefronts, film and merch
// rights, esports, review bombs, security exploits, burnout, crowdfunding,
// distressed studios and charity drives. Each one is a real trade-off that
// lands in the inbox without pausing the game; letting it lapse is always safe.
import { GENRES, SCOPE_IDS, UPDATES } from './constants';
import { baseQuality } from './development';
import { pushDecision } from './events';
import { addXp } from './progression';
import { chance, pick, randRange, weightedPick } from './rng';
import { refreshCandidates } from './staff';
import { acquireCompany, acquisitionPrice } from './stocks';
import type { DecisionEvent, Game, World } from './types';
import { activeCompanies, clamp, earn, gamesOf, newId, playerCompany, pushNews, spend, toast } from './util';

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const nice = (n: number) => {
  if (n < 1000) return Math.round(n / 100) * 100;
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
};

/** Days between any two opportunities, and before the same kind repeats. */
const GAP = 24;
const KIND_COOLDOWN = 220;

interface Candidate {
  kind: string;
  weight: number;
  make: () => Omit<DecisionEvent, 'id' | 'day'> | null;
}

function ready(w: World, kind: string): boolean {
  return w.day - (w.player.flags[`ev:${kind}`] ?? -9999) > KIND_COOLDOWN;
}

function mine(w: World): Game[] {
  return gamesOf(w, w.player.companyId);
}

function live(w: World): Game[] {
  return mine(w).filter((g) => g.status === 'released' && g.active > 0);
}

export function opportunitiesDaily(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active' || w.player.gameOver) return;
  crowdfundingDaily(w);
  talentSurgeNotice(w);
  grantNotice(w);
  if (w.day - (w.player.flags.evAny ?? -9999) < GAP || w.pendingEvents.length >= 3) return;
  if (!chance(w, 1 / 30)) return;

  const devs = mine(w).filter((g) => g.status === 'development');
  const games = live(w);
  const pool: Candidate[] = [];

  // a big streamer asks for early access
  const showable = devs.filter((g) => g.workDone / g.workRequired > 0.45);
  if (showable.length && ready(w, 'streamer')) {
    pool.push({
      kind: 'streamer',
      weight: 3,
      make: () => {
        const g = pick(w, showable);
        const fee = nice(clamp(g.budget * 0.08, 2000, 2e6));
        return {
          kind: 'streamer',
          title: `A top streamer wants early access to ${g.title}`,
          body: `One of the biggest streamers in ${GENRES[g.genre].name} games wants to play an early build of ${g.title} live. If the build is good, the hype could be huge. If it is rough, chat will tear it apart.`,
          options: [
            { id: 'keys', label: 'Send a build', description: 'Free. Big hype if the game is good, a hype hit if it is not.' },
            { id: 'sponsor', label: `Sponsored stream (${fmt(fee)})`, description: 'Scripted showcase: safe, moderate hype.', disabled: p.cash < fee },
            { id: 'decline', label: 'Not yet', description: 'Keep it under wraps.' },
          ],
          data: { gameId: g.id, fee },
          expiresDay: w.day + 21,
        };
      },
    });
  }

  // storefront promotion or timed exclusivity
  const sellers = games.filter((g) => g.rev30 > 3000);
  if (sellers.length && ready(w, 'storefront')) {
    pool.push({
      kind: 'storefront',
      weight: 2,
      make: () => {
        const g = pick(w, sellers);
        const fee = nice(clamp(g.rev30 * 0.4, 3000, 5e6));
        const upfront = nice(clamp(g.rev30 * 2.5, 15000, 40e6));
        return {
          kind: 'storefront',
          title: `A storefront offers to promote ${g.title}`,
          body: `GameVault can put ${g.title} on its front page for three weeks, or pay you ${fmt(upfront)} to make it a timed exclusive. Exclusivity means fewer new players for six months.`,
          options: [
            { id: 'feature', label: `Front page (${fmt(fee)})`, description: 'More visibility for 3 weeks.', disabled: p.cash < fee },
            { id: 'exclusive', label: `Take ${fmt(upfront)}`, description: '-25% new players for 6 months.' },
            { id: 'decline', label: 'No thanks', description: '' },
          ],
          data: { gameId: g.id, fee, upfront },
          expiresDay: w.day + 21,
        };
      },
    });
  }

  // film and TV rights for a popular IP
  const ips = Object.values(w.ips).filter((ip) => ip.companyId === p.id && ip.fans > 150000);
  if (ips.length && ready(w, 'film')) {
    pool.push({
      kind: 'film',
      weight: 2,
      make: () => {
        const ip = pick(w, ips);
        const lump = nice(clamp(ip.fans * 0.6, 50000, 200e6));
        const monthly = nice(clamp(ip.fans * 0.035, 3000, 15e6));
        return {
          kind: 'film',
          title: `A film studio wants the rights to ${ip.name}`,
          body: `Hollywood is calling. They can buy the rights outright, or license them with a monthly fee for two years. Either way, a show brings new fans to the series.`,
          options: [
            { id: 'sell', label: `Sell for ${fmt(lump)}`, description: 'Cash now, +10% fans.' },
            { id: 'license', label: `License (${fmt(monthly)}/mo)`, description: '24 months of income, +25% fans.' },
            { id: 'decline', label: 'Keep the rights', description: '' },
          ],
          data: { ipId: ip.id, lump, monthly },
          expiresDay: w.day + 28,
        };
      },
    });
  }

  // merchandise
  const hits = games.filter((g) => g.owners > 40000 && g.userScore >= 60);
  if (hits.length && ready(w, 'merch')) {
    pool.push({
      kind: 'merch',
      weight: 2,
      make: () => {
        const g = pick(w, hits);
        const monthly = nice(clamp(g.owners * 0.05, 2000, 8e6));
        return {
          kind: 'merch',
          title: `A toy company wants to make ${g.title} merchandise`,
          body: `Plushies, figures, hoodies. They will pay ${fmt(monthly)} a month for 18 months. A premium line pays more but fans hate cheap tie-ins if the game is not loved.`,
          options: [
            { id: 'accept', label: `Sign (${fmt(monthly)}/mo)`, description: '18 months of licensing income.' },
            { id: 'premium', label: `Premium line (${fmt(monthly * 1.8)}/mo)`, description: g.userScore >= 80 ? 'Fans love it: reputation +2.' : 'Risky: reputation -3 if fans think it is a cash grab.' },
            { id: 'decline', label: 'Decline', description: '' },
          ],
          data: { gameId: g.id, monthly, loved: g.userScore >= 80 },
          expiresDay: w.day + 21,
        };
      },
    });
  }

  // esports league
  const comp = games.filter((g) => GENRES[g.genre].competitive && g.active > 30000);
  if (comp.length && ready(w, 'esports')) {
    pool.push({
      kind: 'esports',
      weight: 2,
      make: () => {
        const g = pick(w, comp);
        const cost = nice(clamp(g.active * 0.6, 20000, 30e6));
        const monthly = nice(clamp(g.active * 0.02, 2000, 5e6));
        return {
          kind: 'esports',
          title: `An esports league wants ${g.title}`,
          body: `A league wants to build a season around ${g.title}. Funding the prize pool yourself makes it a spectacle; licensing it out is steady money with less buzz.`,
          options: [
            { id: 'sponsor', label: `Fund a season (${fmt(cost)})`, description: 'Players stay longer and new ones tune in for 2 months.', disabled: p.cash < cost },
            { id: 'license', label: `License (${fmt(monthly)}/mo)`, description: '12 months of income, small boost.' },
            { id: 'decline', label: 'Decline', description: '' },
          ],
          data: { gameId: g.id, cost, monthly },
          expiresDay: w.day + 21,
        };
      },
    });
  }

  // review bombing
  const exposed = games.filter((g) => g.active > 5000 && (g.monetization === 'f2pAggressive' || w.day < g.backlashUntil || g.userScore < 55));
  if (exposed.length && ready(w, 'reviewBomb')) {
    pool.push({
      kind: 'reviewBomb',
      weight: 3,
      make: () => {
        const g = pick(w, exposed);
        const cost = nice(Math.max(2000, g.budget * UPDATES.hotfix.costFrac * 4));
        return {
          kind: 'reviewBomb',
          title: `${g.title} is being review-bombed`,
          body: `Thousands of negative reviews appeared overnight. Players are angry about ${g.monetization === 'f2pAggressive' ? 'the monetization' : 'the state of the game'}. How you respond matters.`,
          options: [
            { id: 'patch', label: `Ship a goodwill patch (${fmt(cost)})`, description: 'Fix the complaints. Most of the anger fades.', disabled: p.cash < cost },
            { id: 'apologize', label: 'Public apology', description: 'Free. Calms some players, costs a little reputation.' },
            { id: 'ignore', label: 'Ride it out', description: 'User score drops and players leave for a month.' },
          ],
          data: { gameId: g.id, cost },
          expiresDay: w.day + 21,
          defaultOption: 'ignore',
        };
      },
    });
  }

  // security exploit
  const online = games.filter((g) => (g.multiplayer === 'online' || g.multiplayer === 'massive') && g.active > 3000);
  if (online.length && ready(w, 'exploit')) {
    pool.push({
      kind: 'exploit',
      weight: 2,
      make: () => {
        const g = pick(w, online);
        const bounty = nice(clamp(g.active * 0.4, 5000, 3e6));
        return {
          kind: 'exploit',
          title: `Security researchers found an exploit in ${g.title}`,
          body: `A researcher privately reported a serious exploit in ${g.title}'s servers. They want a bug bounty. Ignore it and there is a real chance it goes public before you notice.`,
          options: [
            { id: 'bounty', label: `Pay the bounty (${fmt(bounty)})`, description: 'Fixed quietly. Reputation +1.', disabled: p.cash < bounty },
            { id: 'ignore', label: 'Ignore it', description: '50% chance of a public breach: reputation and players hit.' },
          ],
          data: { gameId: g.id, bounty },
          expiresDay: w.day + 21,
          defaultOption: 'ignore',
        };
      },
    });
  }

  // burnout
  const staff = w.player.employees.filter((e) => !e.isFounder);
  const avgMorale = staff.length ? staff.reduce((s, e) => s + e.morale, 0) / staff.length : 100;
  if (staff.length >= 4 && avgMorale < 52 && ready(w, 'burnout')) {
    pool.push({
      kind: 'burnout',
      weight: 4,
      make: () => {
        const retreat = nice(staff.length * 900);
        const bonus = nice(staff.reduce((s, e) => s + e.salary, 0) * 0.4);
        return {
          kind: 'burnout',
          title: 'Your team is burning out',
          body: `Average morale is ${Math.round(avgMorale)}%. People are tired and someone is going to quit soon.`,
          options: [
            { id: 'retreat', label: `Team retreat (${fmt(retreat)})`, description: 'Morale +20 for everyone.', disabled: p.cash < retreat },
            { id: 'bonus', label: `Bonuses (${fmt(bonus)})`, description: 'Morale +12 for everyone.', disabled: p.cash < bonus },
            { id: 'ignore', label: 'Push through', description: 'Morale -5.' },
          ],
          data: { retreat, bonus },
          expiresDay: w.day + 21,
          defaultOption: 'ignore',
        };
      },
    });
  }

  // crowdfunding for small studios
  const crowdable = devs.filter((g) => g.workDone / g.workRequired < 0.5 && SCOPE_IDS.indexOf(g.scope) <= 2 && w.player.flags[`crowd:${g.id}`] === undefined);
  if (crowdable.length && p.reputation >= 8 && p.reputation < 60 && ready(w, 'crowdfund')) {
    pool.push({
      kind: 'crowdfund',
      weight: 2,
      make: () => {
        const g = pick(w, crowdable);
        const raise = nice(clamp((g.hype * 80 + p.fans * 0.8 + 8000) * (0.6 + p.reputation / 60), 8000, 3e6));
        const est = Math.max(60, Math.round((g.workRequired - g.workDone) / Math.max(0.5, w.player.employees.length * 0.8)));
        const deadline = Math.round(est * 1.6 + 60);
        return {
          kind: 'crowdfund',
          title: `Fans want to crowdfund ${g.title}`,
          body: `Your community is asking for a crowdfunding campaign. Backers could pledge around ${fmt(raise)}, but they will expect the game within ${deadline} days. Miss it and they will not forget.`,
          options: [
            { id: 'launch', label: `Launch campaign (~${fmt(raise)})`, description: `Cash and hype now. Ship within ${deadline} days or lose reputation.` },
            { id: 'decline', label: 'Stay self-funded', description: '' },
          ],
          data: { gameId: g.id, raise, deadline },
          expiresDay: w.day + 21,
        };
      },
    });
  }

  // a distressed studio looking for a buyer
  const distressed = activeCompanies(w).filter((c) => !c.isPlayer && !c.parentId && c.distressDays > 20 && c.headcount >= 8);
  if (distressed.length && ready(w, 'distressed')) {
    pool.push({
      kind: 'distressed',
      weight: 2,
      make: () => {
        const t = pick(w, distressed);
        const price = nice(acquisitionPrice(w, p, t, 0.6));
        if (price > p.cash * 1.5) return null;
        return {
          kind: 'distressed',
          title: `${t.name} is running out of money and wants a buyer`,
          body: `${t.name} (${t.headcount} staff, ${t.specialties.map((s) => GENRES[s].name).join(', ')}) will sell for ${fmt(price)}, far below its value, if you move before the creditors do.`,
          options: [
            { id: 'buy', label: `Buy for ${fmt(price)}`, description: 'It becomes your subsidiary with its games and IP.', disabled: p.cash < price },
            { id: 'decline', label: 'Pass', description: '' },
          ],
          data: { companyId: t.id, price },
          expiresDay: w.day + 21,
        };
      },
    });
  }

  // charity drive
  if (games.length && p.cash > 30000 && ready(w, 'charity')) {
    pool.push({
      kind: 'charity',
      weight: 1,
      make: () => {
        const amount = nice(clamp(p.cash * 0.02, 2500, 2e6));
        return {
          kind: 'charity',
          title: 'A charity marathon asks for your support',
          body: `A week-long charity stream for children's hospitals asks studios to donate and run in-game events.`,
          options: [
            { id: 'donate', label: `Donate ${fmt(amount)}`, description: 'Reputation +3, players appreciate it.', disabled: p.cash < amount },
            { id: 'decline', label: 'Decline', description: '' },
          ],
          data: { amount },
          expiresDay: w.day + 21,
        };
      },
    });
  }

  if (!pool.length) return;
  const choice = weightedPick(
    w,
    pool,
    pool.map((c) => c.weight),
  );
  const ev = choice.make();
  if (!ev) return;
  w.player.flags.evAny = w.day;
  w.player.flags[`ev:${choice.kind}`] = w.day;
  pushDecision(w, ev);
}

/** Resolution for the opportunity kinds above. Returns false if the kind is not one of ours. */
export function resolveOpportunity(w: World, ev: DecisionEvent, optionId: string): boolean {
  const p = playerCompany(w);
  const d = ev.data;
  const g = d.gameId ? w.games[String(d.gameId)] : undefined;
  switch (ev.kind) {
    case 'streamer': {
      if (!g || g.status !== 'development') return true;
      if (optionId === 'keys') {
        const q = baseQuality(w, g, p);
        if (q + randRange(w, -8, 8) >= 62) {
          g.hype = Math.min(1400, g.hype + 60 + Math.max(0, q - 60) * 6);
          toast(w, `Chat loved ${g.title}! Hype is soaring`, 'good', { category: 'game', link: { route: 'game', id: g.id } });
        } else {
          g.hype = Math.max(0, g.hype * 0.7 - 10);
          toast(w, `The ${g.title} stream went badly`, 'bad', { category: 'game', link: { route: 'game', id: g.id }, body: 'Viewers found it unfinished. Hype took a hit.' });
        }
      } else if (optionId === 'sponsor') {
        spend(p, 'marketing', Number(d.fee));
        g.hype = Math.min(1400, g.hype + 45 + g.hype * 0.1);
      }
      return true;
    }
    case 'storefront': {
      if (!g || g.status !== 'released') return true;
      if (optionId === 'feature') {
        spend(p, 'marketing', Number(d.fee));
        g.viralMult = Math.max(g.viralMult, 1.4);
        g.viralUntil = Math.max(g.viralUntil, w.day + 21);
      } else if (optionId === 'exclusive') {
        earn(p, 'licensing', Number(d.upfront));
        g.viralMult = 0.75;
        g.viralUntil = w.day + 180;
      }
      return true;
    }
    case 'film': {
      const ip = w.ips[String(d.ipId)];
      if (!ip || optionId === 'decline') return true;
      if (optionId === 'sell') {
        earn(p, 'licensing', Number(d.lump));
        ip.fans *= 1.1;
      } else {
        w.player.licenses.push({ id: newId(w, 'lic'), label: `${ip.name} TV series`, monthly: Number(d.monthly), monthsLeft: 24 });
        ip.fans *= 1.25;
      }
      pushNews(w, { kind: 'player', title: `${ip.name} is getting a TV adaptation`, companyId: p.id, tone: 'good' });
      addXp(w, 60);
      return true;
    }
    case 'merch': {
      if (!g || optionId === 'decline') return true;
      const premium = optionId === 'premium';
      const monthly = Number(d.monthly) * (premium ? 1.8 : 1);
      w.player.licenses.push({ id: newId(w, 'lic'), label: `${g.title} merchandise`, monthly, monthsLeft: 18 });
      if (premium) p.reputation = clamp(p.reputation + (d.loved ? 2 : -3), 0, 100);
      return true;
    }
    case 'esports': {
      if (!g || optionId === 'decline') return true;
      if (optionId === 'sponsor') {
        spend(p, 'marketing', Number(d.cost));
        g.goodwill += 4;
        g.freshness = Math.min(1.2, g.freshness + 0.15);
        g.viralMult = Math.max(g.viralMult, 1.25);
        g.viralUntil = Math.max(g.viralUntil, w.day + 60);
        p.reputation = Math.min(100, p.reputation + 2);
        addXp(w, 50);
      } else {
        w.player.licenses.push({ id: newId(w, 'lic'), label: `${g.title} esports league`, monthly: Number(d.monthly), monthsLeft: 12 });
        g.goodwill += 1;
      }
      return true;
    }
    case 'reviewBomb': {
      if (!g) return true;
      if (optionId === 'patch') {
        spend(p, 'development', Number(d.cost));
        g.goodwill += 3;
        g.bugs *= 0.6;
        g.backlashUntil = Math.min(g.backlashUntil, w.day);
      } else if (optionId === 'apologize') {
        g.goodwill += 1;
        p.reputation = Math.max(0, p.reputation - 1);
        g.backlashUntil = Math.max(g.backlashUntil, w.day + 10);
      } else {
        g.userScore = Math.max(1, g.userScore - 6);
        g.goodwill -= 3;
        g.backlashUntil = Math.max(g.backlashUntil, w.day + 30);
        toast(w, `Review bombing drags ${g.title} down`, 'bad', { category: 'game', link: { route: 'game', id: g.id } });
      }
      return true;
    }
    case 'exploit': {
      if (!g) return true;
      if (optionId === 'bounty') {
        spend(p, 'misc', Number(d.bounty));
        p.reputation = Math.min(100, p.reputation + 1);
      } else if (chance(w, 0.5)) {
        p.reputation = Math.max(0, p.reputation - 7);
        g.userScore = Math.max(1, g.userScore - 8);
        g.backlashUntil = Math.max(g.backlashUntil, w.day + 30);
        g.meltdownUntil = Math.max(g.meltdownUntil, w.day + 2);
        pushNews(w, { kind: 'player', title: `Hackers breach ${g.title}: player accounts exposed`, companyId: p.id, gameId: g.id, tone: 'bad' });
        toast(w, `${g.title} was breached through the reported exploit`, 'bad', { category: 'game', link: { route: 'game', id: g.id }, body: 'Reputation and user score fell sharply.' });
      }
      return true;
    }
    case 'burnout': {
      const bump = optionId === 'retreat' ? 20 : optionId === 'bonus' ? 12 : -5;
      if (optionId === 'retreat') spend(p, 'perks', Number(d.retreat));
      if (optionId === 'bonus') spend(p, 'salaries', Number(d.bonus));
      for (const e of w.player.employees) if (!e.isFounder) e.morale = clamp(e.morale + bump, 0, 100);
      return true;
    }
    case 'crowdfund': {
      if (!g || g.status !== 'development' || optionId !== 'launch') return true;
      const raised = nice(Number(d.raise) * randRange(w, 0.75, 1.3));
      earn(p, 'other', raised);
      g.hype = Math.min(1400, g.hype + 50);
      w.player.flags[`crowd:${g.id}`] = w.day + Number(d.deadline);
      toast(w, `Crowdfunding raised ${fmt(raised)} for ${g.title}`, 'good', { category: 'finance', link: { route: 'game', id: g.id }, body: `Backers expect it within ${d.deadline} days.` });
      return true;
    }
    case 'distressed': {
      if (optionId !== 'buy') return true;
      const t = w.companies[String(d.companyId)];
      const price = Number(d.price);
      if (!t || t.status !== 'active' || t.parentId || p.cash < price) {
        toast(w, 'The distressed studio deal fell through', 'neutral', { category: 'industry' });
        return true;
      }
      acquireCompany(w, p, t, price);
      addXp(w, 120);
      return true;
    }
    case 'charity': {
      if (optionId !== 'donate') return true;
      spend(p, 'misc', Number(d.amount));
      p.reputation = Math.min(100, p.reputation + 3);
      for (const x of live(w)) x.goodwill += 1.5;
      addXp(w, 30);
      return true;
    }
  }
  return false;
}

/** Crowdfunding promises: ship on time, or backers turn on you. */
function crowdfundingDaily(w: World): void {
  const flags = w.player.flags;
  for (const key of Object.keys(flags)) {
    if (!key.startsWith('crowd:')) continue;
    const deadline = flags[key];
    if (deadline < 0) continue;
    const g = w.games[key.slice(6)];
    const p = playerCompany(w);
    if (!g || g.status === 'cancelled') {
      flags[key] = -1;
      p.reputation = Math.max(0, p.reputation - 10);
      toast(w, 'Backers are furious about the cancelled crowdfunded game', 'bad', { category: 'studio', body: 'Reputation -10.' });
    } else if (g.status !== 'development') {
      flags[key] = -1;
      if (g.releaseDay !== null && g.releaseDay <= deadline) {
        p.reputation = Math.min(100, p.reputation + 3);
        toast(w, `Backers celebrate ${g.title} shipping on time`, 'good', { category: 'studio', body: 'Reputation +3.' });
      }
    } else if (w.day === deadline) {
      p.reputation = Math.max(0, p.reputation - 6);
      g.hype *= 0.8;
      toast(w, `${g.title} missed its crowdfunding promise`, 'bad', { category: 'game', link: { route: 'game', id: g.id }, body: 'Backers are angry. Reputation -6.' });
    } else if (w.day === deadline - 30) {
      toast(w, `${g.title} is due to backers in 30 days`, 'neutral', { category: 'game', link: { route: 'game', id: g.id } });
    }
  }
}

/** A big studio collapse floods the market with experienced developers. */
function talentSurgeNotice(w: World): void {
  const until = w.market.talentSurgeUntil;
  if (until <= w.day || w.player.flags.surgeSeen === until) return;
  w.player.flags.surgeSeen = until;
  refreshCandidates(w);
  toast(w, 'Veteran developers are looking for work', 'neutral', { category: 'studio', link: { route: 'team' }, body: 'A studio collapse means stronger candidates for the next two months.' });
}

/** Small studios occasionally win an indie development grant. */
function grantNotice(w: World): void {
  const p = playerCompany(w);
  if (w.player.employees.length > 8 || p.reputation > 35) return;
  if (!mine(w).some((g) => g.status === 'development')) return;
  if (w.day - (w.player.flags.grant ?? -9999) < 365 || !chance(w, 1 / 400)) return;
  w.player.flags.grant = w.day;
  const amount = nice(randRange(w, 8000, 25000));
  earn(p, 'other', amount);
  toast(w, `Your studio won an indie development grant: ${fmt(amount)}`, 'good', { category: 'finance', link: { route: 'finance' } });
}
