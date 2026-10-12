import { founderStake } from './stocks';
import { addXp } from './progression';
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
  { id: 'engine', name: 'Engine Architect', desc: 'Build your own game engine.', check: (w) => w.player.research.completed.includes('engine1') },
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
