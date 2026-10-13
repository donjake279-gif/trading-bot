import { CalendarDays, Gift, Lock, PartyPopper, Presentation, RefreshCw, Sparkles, Star, Target, Ticket, Trophy } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { CONVENTIONS, EXPO_BOOTHS, MAX_LEVEL, PERKS, PERK_IDS, xpForLevel } from '../../engine/constants';
import { conventionBlocker, conventionName, hostConvention } from '../../engine/fun';
import { OBJECTIVE_LIFETIME, objectiveProgress, perkRank, rerollObjective, spendPerk } from '../../engine/progression';
import { bookExpo } from '../../engine/business';
import { EXPO_DATE, parts, upcomingEvents } from '../../engine/calendar';
import type { Objective, World } from '../../engine/types';
import { playerCompany } from '../../engine/util';
import { date, money, num } from '../lib/format';
import { Badge, Button, Card, Progress, SectionTitle, cx } from '../components/ui';

function progressLabel(o: Objective, value: number): string {
  const money_ = o.kind === 'monthRevenue' || o.kind === 'valuation' || o.kind === 'cash';
  const f = (n: number) => (money_ ? money(n) : num(n));
  return `${f(Math.max(0, Math.min(value, o.target)))} / ${f(o.target)}`;
}

export function GoalCard({ o, compact }: { o: Objective; compact?: boolean }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const value = objectiveProgress(w, o);
  const cooldown = 30 - (w.day - w.player.objectiveRerollDay);
  const expires = o.createdDay + OBJECTIVE_LIFETIME - w.day;
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-start gap-2">
        <Target size={15} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 text-sm font-medium leading-snug">{o.title}</div>
        {!compact && (
          <button
            className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
            disabled={cooldown > 0}
            title={cooldown > 0 ? `Swap available in ${cooldown} days` : 'Swap for a different goal'}
            onClick={() => act((world) => rerollObjective(world, o.id))}
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      <Progress value={value} max={o.target} className="mt-2" tone={value >= o.target ? 'good' : 'accent'} />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="tabular">{progressLabel(o, value)}</span>
        <span className="flex items-center gap-1.5">
          <Gift size={11} className="text-good" />
          <span className="text-sub">
            {money(o.rewardCash)} · {o.rewardXp} XP{o.rewardPerk ? ' · perk point' : ''}
          </span>
        </span>
      </div>
      {!compact && expires < 60 && <div className="mt-1 text-[11px] text-warn">Expires in {Math.max(0, expires)} days</div>}
    </div>
  );
}

function nextExpoYear(w: World): number {
  const { year, month, date: d } = parts(w.day);
  const passed = month > EXPO_DATE[0] || (month === EXPO_DATE[0] && d >= EXPO_DATE[1]);
  return passed ? year + 1 : year;
}

export function Goals() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const p = playerCompany(w);
  const pr = w.player.progression;
  const need = xpForLevel(pr.level);
  const expoYear = nextExpoYear(w);
  const booked = w.player.expoBooking?.year === expoYear ? w.player.expoBooking.tier : 0;
  const events = upcomingEvents(w.day, 5);

  return (
    <div className="space-y-4">
      <SectionTitle>Goals &amp; Perks</SectionTitle>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
              <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-surface-3)" strokeWidth="7" />
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 34}
                  strokeDashoffset={2 * Math.PI * 34 * (1 - Math.min(1, pr.xp / need))}
                  style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                />
              </svg>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted">Level</div>
                <div className="text-2xl font-bold tabular leading-none">{pr.level}</div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="text-xs text-muted tabular">
                {pr.level >= MAX_LEVEL ? 'Max level' : `${num(pr.xp)} / ${num(need)} XP to level ${pr.level + 1}`}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={pr.perkPoints > 0 ? 'good' : 'neutral'}>
                  <Sparkles size={11} /> {pr.perkPoints} perk point{pr.perkPoints === 1 ? '' : 's'}
                </Badge>
                <Badge>
                  <Trophy size={11} /> {w.player.objectivesCompleted} goals done
                </Badge>
              </div>
            </div>
          </div>
          <div className="mt-4 text-xs leading-relaxed text-muted">
            Earn XP by shipping games and updates, delivering contracts, hitting player milestones, winning awards and completing goals. Every level gives a perk point.
          </div>
        </Card>

        <Card className="lg:col-span-2" title="Current goals" subtitle="Three at a time. Swap one every 30 days if it doesn't suit your plans.">
          <div className="grid gap-2 md:grid-cols-3">
            {w.player.objectives.map((o) => (
              <GoalCard key={o.id} o={o} />
            ))}
            {w.player.objectives.length === 0 && <div className="text-sm text-muted">New goals arrive tomorrow.</div>}
          </div>
        </Card>
      </div>

      <Card title="Perks" subtitle="Permanent upgrades for your studio. Higher ranks need a higher studio level.">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {PERK_IDS.map((id) => {
            const def = PERKS[id];
            const rank = perkRank(w, id);
            const needLevel = def.minLevel + rank * 2;
            const maxed = rank >= def.maxRank;
            const locked = pr.level < needLevel;
            return (
              <div key={id} className={cx('flex flex-col rounded-lg border p-3', maxed ? 'border-good/30 bg-good-soft/20' : 'border-line bg-surface-2')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{def.name}</span>
                  <span className="flex gap-0.5">
                    {Array.from({ length: def.maxRank }, (_, k) => (
                      <Star key={k} size={12} className={k < rank ? 'fill-warn text-warn' : 'text-line'} />
                    ))}
                  </span>
                </div>
                <p className="mt-1 flex-1 text-xs text-sub">{def.blurb}</p>
                {maxed ? (
                  <div className="mt-2 text-[11px] font-medium text-good">Maxed</div>
                ) : (
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    variant={!locked && pr.perkPoints > 0 ? 'primary' : 'secondary'}
                    disabled={locked || pr.perkPoints <= 0}
                    onClick={() => act((world) => spendPerk(world, id), `${def.name} rank ${rank + 1}`)}
                  >
                    {locked ? (
                      <>
                        <Lock size={12} /> Level {needLevel}
                      </>
                    ) : (
                      `Rank ${rank + 1} · 1 point`
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title={`GameExpo ${expoYear}`}
          subtitle={`${date(events.find((e) => e.kind === 'expo')?.day ?? w.day)} · Show games in development to the world. Bigger stages, bigger hype.`}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {EXPO_BOOTHS.slice(1).map((b, k) => {
              const tier = k + 1;
              const have = booked >= tier;
              const cost = b.cost - EXPO_BOOTHS[booked].cost;
              return (
                <div key={b.name} className={cx('rounded-lg border p-3', have ? 'border-accent bg-accent-soft/30' : 'border-line bg-surface-2')}>
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Presentation size={14} className="text-accent" />
                    {b.name}
                  </div>
                  <div className="mt-1 text-xs text-muted">+{b.hype} hype per game in development</div>
                  {have ? (
                    <Badge tone="accent" className="mt-2">
                      Booked
                    </Badge>
                  ) : (
                    <Button size="sm" className="mt-2 w-full" disabled={p.cash < cost} onClick={() => act((world) => bookExpo(world, tier), `Booked: ${b.name}`)}>
                      {booked > 0 ? 'Upgrade' : 'Book'} · {money(cost)}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-muted">Live games also get a two-week visibility boost from the show. Your reputation increases the hype you get.</div>
        </Card>
        <Card title="Industry calendar" subtitle="Plan launches around the big moments of the year.">
          <ul className="space-y-2.5">
            {events.map((e) => (
              <li key={`${e.name}-${e.day}`} className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-surface-2 text-[10px] leading-tight">
                  <CalendarDays size={12} className="text-accent" />
                  <span className="tabular text-sub">{e.day - w.day <= 0 ? 'now' : `${e.day - w.day}d`}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{e.name}</div>
                  <div className="text-xs text-muted">
                    {date(e.day)} · {e.detail}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Convention />
    </div>
  );
}

function Convention() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const p = playerCompany(w);
  const con = w.player.convention;
  return (
    <Card
      title="Your own fan convention"
      subtitle={`Throw a party for your fans: ticket sales, hype for upcoming games, a boost for live ones and a happy team. ${w.player.conventionsHeld} held so far.`}
    >
      {con ? (
        <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft/30 p-3 text-sm">
          <PartyPopper size={18} className="text-accent" />
          <span className="flex-1">
            <span className="font-semibold">{conventionName(w, con.tier)}</span> opens {date(con.day)} ({con.day - w.day} days)
          </span>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {CONVENTIONS.map((c, tier) => {
            const blocker = conventionBlocker(w, tier);
            return (
              <div key={c.name} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Ticket size={14} className="text-accent" />
                  {conventionName(w, tier)}
                </div>
                <div className="mt-1 text-xs text-muted">
                  ×{c.scale} scale · reputation {c.minRep}+
                </div>
                <Button size="sm" className="mt-2 w-full" variant={blocker ? 'secondary' : 'primary'} disabled={!!blocker} title={blocker ?? undefined} onClick={() => act((world) => hostConvention(world, tier))}>
                  {blocker && !blocker.startsWith('Costs') ? blocker : `Host · ${money(c.cost)}`}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {p.reputation < CONVENTIONS[0].minRep && <div className="mt-2 text-xs text-muted">Grow your reputation to start hosting events.</div>}
    </Card>
  );
}
