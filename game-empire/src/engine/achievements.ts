import { founderStake } from './stocks';
import { addXp } from './progression';
import { ownedCapacity } from './datacenters';
import type { World } from './types';
import { activeCompanies, playerCompany, pushNews, toast } from './util';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  check: (w: World) => boolean;
}

function playerGames(w: World) {
  return Object.values(w.games).filter((g) => g.companyId === w.player.companyId);
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_game', name: 'Hello, World', desc: 'Release your first game.', check: (w) => w.player.stats.gamesReleased >= 1 },
  { id: 'first_hire', name: 'Not Alone Anymore', desc: 'Hire your first employee.', check: (w) => w.player.employees.length >= 2 },
  { id: 'ccu_1k', name: 'Somebody Is Playing', desc: 'Reach 1,000 concurrent players on one game.', check: (w) => w.player.stats.peakCcu >= 1000 },
  { id: 'critic_80', name: 'Critical Darling', desc: 'Earn a critic score of 80 or more.', check: (w) => w.player.stats.bestCritic >= 80 },
  { id: 'rev_100k', name: 'Ramen Profitable', desc: 'Earn $100K in lifetime revenue.', check: (w) => playerCompany(w).revenueTotal >= 1e5 },
  { id: 'team_10', name: 'Real Studio', desc: 'Employ 10 people.', check: (w) => w.player.employees.length >= 10 },
  { id: 'ccu_100k', name: 'Packed Servers', desc: 'Reach 100,000 concurrent players on one game.', check: (w) => w.player.stats.peakCcu >= 1e5 },
  { id: 'rev_1m', name: 'Millionaire Studio', desc: 'Earn $1M in lifetime revenue.', check: (w) => playerCompany(w).revenueTotal >= 1e6 },
  { id: 'sequel', name: 'Franchise Builder', desc: 'Release a sequel.', check: (w) => playerGames(w).some((g) => g.sequelNo > 1 && g.releaseDay !== null) },
  { id: 'live_service', name: 'Live Service', desc: 'Ship 5 updates for a single game.', check: (w) => playerGames(w).some((g) => g.updates.length >= 5) },
  { id: 'critic_90', name: 'Masterpiece', desc: 'Earn a critic score of 90 or more.', check: (w) => w.player.stats.bestCritic >= 90 },
  { id: 'award', name: 'On Stage', desc: 'Win a Game Awards category.', check: (w) => w.awardsHistory.some((a) => a.companyId === w.player.companyId) },
  { id: 'engine', name: 'Engine Architect', desc: 'Found your own game engine.', check: (w) => !!w.player.engine },
  { id: 'engine_v3', name: 'Version Three', desc: 'Ship version 3.0 of your engine.', check: (w) => (w.player.engine?.version ?? 0) >= 3 },
  { id: 'engine_v5', name: 'Unreal-istic', desc: 'Ship version 5.0 of your engine with every module maxed.', check: (w) => (w.player.engine?.version ?? 0) >= 5 },
  { id: 'licensee', name: 'Powered By You', desc: 'A rival studio licenses your engine.', check: (w) => (w.player.engine?.gamesBuilt ?? 0) >= 1 },
  { id: 'engine_10', name: 'Engine of Choice', desc: '10 rival projects built on your engine.', check: (w) => (w.player.engine?.gamesBuilt ?? 0) >= 10 },
  { id: 'combo_10', name: 'Trend Spotter', desc: 'Discover 10 genre and topic combos.', check: (w) => Object.keys(w.player.combos).length >= 10 },
  { id: 'combo_legend', name: 'Mad Genius', desc: 'Ship a legendary combo.', check: (w) => Object.values(w.player.combos).includes('legendary') },
  { id: 'platinum', name: 'Going Platinum', desc: 'Get a game certified Platinum.', check: (w) => playerGames(w).some((g) => g.certified >= 3) },
  { id: 'diamond', name: 'Diamond Hands', desc: 'Get a game certified Diamond.', check: (w) => playerGames(w).some((g) => g.certified >= 4) },
  { id: 'remaster', name: 'Remember This?', desc: 'Release a remaster of one of your classics.', check: (w) => playerGames(w).some((g) => g.remasterOf && g.releaseDay !== null) },
  { id: 'legend_hire', name: 'Star Power', desc: 'Hire an industry legend.', check: (w) => w.player.employees.some((e) => e.traits.includes('legend')) },
  { id: 'convention', name: 'Fan Service', desc: 'Host your own fan convention.', check: (w) => w.player.conventionsHeld >= 1 },
  { id: 'facilities_5', name: 'Dream Office', desc: 'Build 5 office facilities.', check: (w) => w.player.facilities.length >= 5 },
  { id: 'nominee', name: 'And the Nominees Are', desc: 'Get a Game Awards nomination.', check: (w) => [...w.awardArchive, ...(w.awardSeason ? [w.awardSeason] : [])].some((s) => s.categories.some((c) => c.id !== 'glitch' && c.nominees.some((n) => n.companyId === w.player.companyId))) },
  { id: 'sweep', name: 'Clean Sweep', desc: 'Win 3 or more Game Awards in one year.', check: (w) => { const by = new Map<number, number>(); for (const a of w.awardsHistory) if (a.companyId === w.player.companyId && a.category !== 'The Golden Glitch') by.set(a.year, (by.get(a.year) ?? 0) + 1); return [...by.values()].some((n) => n >= 3); } },
  { id: 'studio_year', name: 'Studio of the Year', desc: 'Be named Studio of the Year.', check: (w) => w.awardsHistory.some((a) => a.companyId === w.player.companyId && a.category === 'Studio of the Year') },
  { id: 'oracle', name: 'The Oracle', desc: 'Correctly predict Game of the Year.', check: (w) => (w.player.flags.oracle ?? 0) >= 1 },
  { id: 'golden_glitch', name: 'Glitch Royalty', desc: '"Win" the Golden Glitch. Congratulations?', check: (w) => w.awardsHistory.some((a) => a.companyId === w.player.companyId && a.category === 'The Golden Glitch') },
  { id: 'jam_hit', name: 'Weekend Warriors', desc: 'Turn a game jam entry into a hit.', check: (w) => Object.values(w.games).some((g) => g.companyId === w.player.companyId && g.price === 0.99 && g.scope === 'tiny' && g.criticScore >= 75 && g.budget === 0) },
  { id: 'dc_first', name: 'Metal Under Your Feet', desc: 'Open a data center of your own.', check: (w) => w.player.infra.dataCenters.some((d) => w.day >= d.readyDay) },
  { id: 'dc_regions', name: 'Around the World', desc: 'Run data centers on 3 continents.', check: (w) => new Set(w.player.infra.dataCenters.filter((d) => w.day >= d.readyDay).map((d) => d.region)).size >= 3 },
  { id: 'dc_campus', name: 'Hyperscaler', desc: 'Own a Hyperscale Campus.', check: (w) => w.player.infra.dataCenters.some((d) => d.building >= 5 && w.day >= d.readyDay) },
  { id: 'dc_million', name: 'A Million Seats', desc: 'Own servers for 1,000,000 players.', check: (w) => ownedCapacity(w, false) >= 1e6 },
  { id: 'store', name: 'Storefront', desc: 'Launch your own game store.', check: (w) => !!w.player.store },
  { id: 'hq', name: 'Corner Office', desc: 'Move into Headquarters.', check: (w) => w.player.officeLevel >= 4 },
  { id: 'ccu_1m', name: 'Phenomenon', desc: 'Reach 1,000,000 concurrent players on one game.', check: (w) => w.player.stats.peakCcu >= 1e6 },
  { id: 'team_100', name: 'Hundred Strong', desc: 'Employ 100 people.', check: (w) => w.player.employees.length >= 100 },
  { id: 'acquire', name: 'Shark', desc: 'Acquire another studio.', check: (w) => w.player.stats.acquisitions >= 1 },
  { id: 'ipo', name: 'Ring the Bell', desc: 'Take your company public.', check: (w) => playerCompany(w).isPublic },
  { id: 'unicorn', name: 'Unicorn', desc: 'Reach a $1B valuation.', check: (w) => playerCompany(w).valuation >= 1e9 },
  { id: 'goty', name: 'Game of the Year', desc: 'Win Game of the Year.', check: (w) => w.awardsHistory.some((a) => a.companyId === w.player.companyId && a.category === 'Game of the Year') },
  { id: 'rev_1b', name: 'Billion-Dollar Catalogue', desc: 'Earn $1B in lifetime revenue.', check: (w) => playerCompany(w).revenueTotal >= 1e9 },
  { id: 'number_one', name: 'King of the Hill', desc: 'Become the most valuable studio in the industry.', check: (w) => {
    const p = playerCompany(w);
    return p.valuation > 1e8 && activeCompanies(w).every((c) => c.id === p.id || c.parentId === p.id || c.valuation <= p.valuation);
  } },
  { id: 'empire', name: 'Game Empire', desc: 'Own 3 subsidiaries.', check: (w) => Object.values(w.companies).filter((c) => c.parentId === w.player.companyId && c.status === 'active').length >= 3 },
  { id: 'titan', name: 'Titan of Industry', desc: 'Reach a $100B valuation.', check: (w) => playerCompany(w).valuation >= 1e11 },
  { id: 'level_10', name: 'Rising Studio', desc: 'Reach studio level 10.', check: (w) => w.player.progression.level >= 10 },
  { id: 'level_25', name: 'Industry Veteran', desc: 'Reach studio level 25.', check: (w) => w.player.progression.level >= 25 },
  { id: 'goals_10', name: 'Goal Getter', desc: 'Complete 10 studio goals.', check: (w) => w.player.objectivesCompleted >= 10 },
  { id: 'contracts_5', name: 'Hired Guns', desc: 'Deliver 5 client contracts.', check: (w) => w.player.contractsCompleted >= 5 },
  { id: 'regional', name: 'Going Global', desc: 'Run your games on Regional Data Centers or better.', check: (w) => w.player.infra.tier >= 3 },
  { id: 'uptime', name: 'Five Nines', desc: 'Run Hyperscale Edge servers.', check: (w) => w.player.infra.tier >= 5 },
  { id: 'planetary', name: 'Planet Scale', desc: 'Run your games on the Planetary Mesh.', check: (w) => w.player.infra.tier >= 6 },
  { id: 'orbital', name: 'Out of This World', desc: 'Put your servers in orbit with the Orbital Server Ring.', check: (w) => w.player.infra.tier >= 7 },
  { id: 'investor', name: 'Smart Money', desc: 'Hold $1M in investments.', check: (w) => w.player.investments.bonds + w.player.investments.indexUnits * w.market.index >= 1e6 },
  { id: 'publisher', name: 'Publisher', desc: 'Earn $1M from publishing other studios\' games.', check: (w) => w.player.publishing.reduce((s, d) => s + d.earned, 0) + (w.player.flags.publishingEarned ?? 0) >= 1e6 },
  { id: 'max_perk', name: 'Specialist', desc: 'Max out a perk.', check: (w) => Object.values(w.player.progression.perks).some((r) => (r ?? 0) >= 3) },
  { id: 'control', name: 'Iron Grip', desc: 'Be public while still owning over 50% of your company.', check: (w) => playerCompany(w).isPublic && founderStake(playerCompany(w)) > 0.5 },
];

export function checkAchievements(w: World): void {
  const p = playerCompany(w);
  if (!p) return;
  for (const a of ACHIEVEMENTS) {
    if (w.player.achievements[a.id] !== undefined) continue;
    if (a.check(w)) {
      w.player.achievements[a.id] = w.day;
      pushNews(w, { kind: 'player', title: `Achievement unlocked: ${a.name}`, body: a.desc, companyId: p.id, tone: 'good' });
      toast(w, `Achievement unlocked: ${a.name}`, 'good', { category: 'goal', link: { route: 'achievements' }, body: a.desc });
      addXp(w, 50);
    }
  }
}
