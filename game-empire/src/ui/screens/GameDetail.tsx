import { useMemo, useState } from 'react';
import { Bug, Copy, Disc3, Flame, Megaphone, Power, Rocket, Sparkles, Tag, ThumbsDown, ThumbsUp, Trophy, Users, Wrench, X } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import {
  AUDIENCES,
  CAMPAIGNS,
  CAMPAIGN_IDS,
  FOCUS_IDS,
  FOCUS_LABELS,
  GENRES,
  MONETIZATIONS,
  MONETIZATION_IDS,
  MULTIPLAYER,
  PLATFORMS,
  PLATFORM_IDS,
  ROLES,
  SCOPES,
  UPDATES,
  UPDATE_IDS,
} from '../../engine/constants';
import {
  assignDevs,
  assignEmployee,
  campaignHype,
  cancelGame,
  cancelUpdate,
  queueUpdates,
  releasePlayerGame,
  removeQueuedUpdate,
  runCampaign,
  setAutoUpdates,
  setCrunch,
  setFocus,
  setPrice,
  shutdownServers,
  startDiscount,
} from '../../engine/actions';
import { bugDensity, hasResearch, playerDailyWork, qualityEstimate } from '../../engine/development';
import { ratingOf } from '../../engine/market';
import { CREW_OUTPUT, MAX_CONTENT_LEVEL, contentLevelOf, updateCost, updateFatigue, updateWork, versionLabel } from '../../engine/updates';
import { isAutoUpdated } from '../../engine/automation';
import { infraEffects, isOnline } from '../../engine/infra';
import { certificationName, remasterBlocker, startRemaster } from '../../engine/fun';
import { criticReviews, playerReviews, topicLabel } from '../../engine/reviews';
import { engineDisplayName } from '../../engine/studioEngine';
import { playerCompany, reviewLabel } from '../../engine/util';
import type { Employee, Game, MonetizationId, PlatformId, UpdateTypeId } from '../../engine/types';
import { date, days, money, num, pct } from '../lib/format';
import { statusLabel } from '../lib/selectors';
import { TimeChart } from '../components/charts';
import { Badge, Button, Card, ConfirmButton, Empty, Kv, LiveNumber, Modal, Progress, ScoreBadge, SectionTitle, Stat, Tabs, cx, inputClass } from '../components/ui';
import { projectCoverage, rebalanceFocus } from './CreateGame';

export function GameDetail({ id }: { id: string }) {
  const w = useWorld();
  const g = w.games[id];
  if (!g) return <Empty title="Game not found" />;
  if (g.companyId !== w.player.companyId) return <Empty title="This game belongs to another company" />;
  return g.status === 'development' ? <DevView g={g} /> : <LiveView g={g} />;
}

function Header({ g, actions }: { g: Game; actions?: React.ReactNode }) {
  const w = useWorld();
  const known = g.topic ? w.player.combos[`${g.genre}:${g.topic}`] : undefined;
  return (
    <div className="mb-4">
      <SectionTitle actions={actions}>{g.title}</SectionTitle>
      <div className="-mt-2 flex flex-wrap gap-1.5">
        <Badge tone={g.status === 'released' ? 'good' : g.status === 'development' ? 'accent' : 'neutral'}>{statusLabel(g)}</Badge>
        <Badge>{SCOPES[g.scope].name}</Badge>
        <Badge>{GENRES[g.genre].name}</Badge>
        {g.topic && (
          <Badge tone={known === 'legendary' ? 'warn' : known === 'great' ? 'good' : known === 'bad' ? 'bad' : 'neutral'} title={known ? `${known} combo` : 'Combo not tested yet'}>
            {topicLabel(g)}
            {known ? ` · ${known}` : ''}
          </Badge>
        )}
        {g.certified > 0 && (
          <Badge tone="warn">
            <Disc3 size={11} /> {certificationName(g.certified)}
          </Badge>
        )}
        {g.remasterOf && <Badge tone="accent">Remaster</Badge>}
        {(() => {
          const s = w.awardSeason;
          if (!s || s.done) return null;
          const n = s.categories.filter((c) => c.id !== 'glitch' && c.nominees.some((x) => x.id === g.id)).length;
          return n > 0 ? (
            <Badge tone="warn">
              <Trophy size={11} /> {n} Game Awards nomination{n > 1 ? 's' : ''}
            </Badge>
          ) : null;
        })()}
        <Badge>{AUDIENCES[g.audience].name}</Badge>
        <Badge>{MULTIPLAYER[g.multiplayer].name}</Badge>
        <Badge>{MONETIZATIONS[g.monetization].short}{g.price > 0 ? ` $${g.price.toFixed(2)}` : ''}</Badge>
        <Badge>{engineDisplayName(w, g.engine)}</Badge>
        {g.platforms.map((p) => (
          <Badge key={p}>{PLATFORMS[p].name}</Badge>
        ))}
        {g.sequelNo > 1 && <Badge tone="accent">Sequel #{g.sequelNo}</Badge>}
        {g.publisherCut > 0 && <Badge tone="warn">Publisher takes {pct(g.publisherCut)}</Badge>}
        {g.awards.map((a) => (
          <Badge key={a} tone="good">
            <Trophy size={11} /> {a}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ team picker

function TeamPicker({ g, title }: { g: Game; title: string }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const team = w.player.employees.filter((e) => e.assignment === g.id);
  const available = w.player.employees.filter((e) => ROLES[e.role].dev && e.assignment !== g.id);
  const [adding, setAdding] = useState(false);
  return (
    <Card
      title={title}
      subtitle={`${team.length} assigned · payroll ${money(team.reduce((s, e) => s + e.salary, 0))}/mo`}
      actions={
        <>
          <Button size="sm" onClick={() => act((world) => assignDevs(world, g.id, 'idle'), 'Idle developers joined')} disabled={!w.player.employees.some((e) => ROLES[e.role].dev && !e.assignment)}>
            All idle
          </Button>
          <Button size="sm" onClick={() => act((world) => assignDevs(world, g.id, 'everyone'), 'The whole studio is on this game')} disabled={available.length === 0}>
            Everyone
          </Button>
          <Button size="sm" onClick={() => setAdding(true)} disabled={available.length === 0}>
            <Users size={13} /> Pick
          </Button>
        </>
      }
    >
      {team.length === 0 ? (
        <div className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">Nobody is working on this. Add people to make progress.</div>
      ) : (
        <div className="space-y-1">
          {team.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="text-xs text-muted">{e.isFounder ? 'Founder' : ROLES[e.role].name}</span>
              <span className="w-14 text-right text-xs tabular text-sub">skill {Math.round(e.skill)}</span>
              <button onClick={() => act((world) => assignEmployee(world, e.id, null))} className="rounded p-0.5 text-muted hover:text-bad" aria-label="Remove">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title={`Add people to ${g.title}`}>
        <div className="space-y-1.5">
          {available.map((e) => {
            const busy = e.assignment ? w.games[e.assignment] : null;
            return (
              <button
                key={e.id}
                onClick={() => act((world) => assignEmployee(world, e.id, g.id))}
                className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left hover:border-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{e.name}</div>
                  <div className="text-xs text-muted">
                    {e.isFounder ? 'Founder' : ROLES[e.role].name} · skill {Math.round(e.skill)} · morale {Math.round(e.morale)}
                    {busy && <span className="text-warn"> · currently on {busy.title}</span>}
                  </div>
                </div>
                <Badge tone="accent">Add</Badge>
              </button>
            );
          })}
          {available.length === 0 && <div className="text-sm text-muted">Everyone is already on this project.</div>}
        </div>
      </Modal>
    </Card>
  );
}

function Marketing({ g }: { g: Game }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  return (
    <Card title="Marketing" subtitle={`Hype ${Math.round(g.hype)}${g.status === 'development' ? ` · ${num(g.wishlists)} wishlists` : ''} · spent ${money(g.marketingSpent)}`}>
      <div className="space-y-1.5">
        {CAMPAIGN_IDS.map((id) => {
          const def = CAMPAIGNS[id];
          const gain = campaignHype(w, g, id);
          return (
            <div key={id} className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <Megaphone size={15} className="text-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{def.name}</div>
                <div className="text-[11px] text-muted">{def.blurb}</div>
              </div>
              <div className="text-right text-xs">
                <div className="tabular text-good">+{Math.round(gain)} hype</div>
                <div className="tabular text-muted">{money(def.cost)}</div>
              </div>
              <Button size="sm" disabled={c.cash < def.cost} onClick={() => act((world) => runCampaign(world, g.id, id))}>
                Run
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">Hype decays over time. Before launch it builds wishlists that convert on release day.</p>
    </Card>
  );
}

// ------------------------------------------------------------ development

function DevView({ g }: { g: Game }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const c = playerCompany(w);
  const team = w.player.employees.filter((e) => e.assignment === g.id);
  const daily = playerDailyWork(w, g, team);
  const progress = g.workDone / g.workRequired;
  const remaining = daily > 0 ? Math.max(0, g.workRequired - g.workDone) / daily : Infinity;
  const est = qualityEstimate(w, g, c);
  const density = bugDensity(g);
  const { cov } = useMemo(() => projectCoverage(w, g, team), [w, g, team]);
  const analytics = hasResearch(w, 'analytics');

  return (
    <div>
      <Header
        g={g}
        actions={
          <>
            <ConfirmButton
              size="md"
              confirmLabel={`Lose ${money(g.budgetSpent + g.staffCost)}? Click again`}
              title="Money already spent is lost; the team becomes free"
              onConfirm={() => {
                act((world) => cancelGame(world, g.id));
                navigate({ name: 'projects' });
              }}
            >
              Cancel project
            </ConfirmButton>
            <Button variant="primary" disabled={progress < 0.75} onClick={() => act((world) => releasePlayerGame(world, g.id))} title={progress < 0.75 ? 'Needs 75% progress' : undefined}>
              <Rocket size={15} /> Release{progress < 1 ? ' early' : ''}
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Progress">
            <div className="flex items-end justify-between">
              <div className="text-3xl font-bold tabular">{Math.min(100, Math.round(progress * 100))}%</div>
              <div className="text-right text-sm text-sub">
                {progress >= 1 ? (
                  <span className="text-good">Feature complete — polishing ({Math.round((progress - 1) * 100)}% extra)</span>
                ) : Number.isFinite(remaining) ? (
                  `~${days(remaining)} remaining`
                ) : (
                  <span className="text-bad">stalled: no team</span>
                )}
              </div>
            </div>
            <Progress value={Math.min(1, progress)} tone={progress >= 1 ? 'good' : 'accent'} height={10} className="mt-2" />
            <div className="mt-4 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              <Kv k="Work" v={`${num(Math.min(g.workDone, g.workRequired))} / ${num(g.workRequired)}`} />
              <Kv k="Speed" v={`${daily.toFixed(1)} pts/day`} />
              <Kv k="Started" v={date(g.createdDay)} />
              <Kv k="Budget spent" v={`${money(g.budgetSpent)} / ${money(g.budget)}`} />
              <Kv k="Salaries so far" v={money(g.staffCost)} />
              <Kv k="Bugs" v={`${Math.round(g.bugs)} (${density.toFixed(1)}/100)`} tone={density > 6 ? 'bad' : density > 3 ? 'warn' : 'good'} />
            </div>
            <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-sub">Projected review score</span>
                <span className="font-semibold tabular">
                  {est.low}–{est.high}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted">
                {analytics ? 'Player Analytics narrows this estimate.' : 'A rough guess. Research Player Analytics for a sharper estimate.'} Polishing after 100% removes bugs and adds a little quality.
              </div>
            </div>
          </Card>

          <Card title="Development focus" subtitle="Coverage = what your team produces vs. what this genre needs.">
            <div className="space-y-3">
              {FOCUS_IDS.map((d) => {
                const share = g.focus[d];
                const ideal = GENRES[g.genre].ideal[d];
                const coverage = cov[d];
                return (
                  <div key={d} className="grid grid-cols-[110px_1fr_120px] items-center gap-3">
                    <div>
                      <div className="text-sm">{FOCUS_LABELS[d]}</div>
                      <div className="text-[11px] text-warn">{analytics ? `target ${pct(ideal)}` : '★'.repeat(ideal >= 0.25 ? 3 : ideal >= 0.14 ? 2 : 1)}</div>
                    </div>
                    <input type="range" min={0} max={100} value={Math.round(share * 100)} onChange={(e) => act((world) => setFocus(world, g.id, rebalanceFocus(g.focus, d, Number(e.target.value) / 100)))} />
                    <div>
                      <div className="flex justify-between text-[11px] text-muted">
                        <span>effort {pct(share)}</span>
                        <span className={coverage >= 0.95 ? 'text-good' : coverage >= 0.7 ? 'text-warn' : 'text-bad'}>{team.length ? `${Math.round(coverage * 100)}%` : '—'}</span>
                      </div>
                      <Progress value={Math.min(1.3, coverage)} max={1.3} tone={coverage >= 0.95 ? 'good' : coverage >= 0.7 ? 'warn' : 'bad'} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <TeamPicker g={g} title="Development team" />
          <Card title="Crunch" subtitle="Mandatory overtime: +30% speed, more bugs, morale drops. Long crunches can leak to the press.">
            <div className="flex items-center justify-between">
              <span className={cx('flex items-center gap-2 text-sm', g.crunch ? 'text-bad' : 'text-sub')}>
                <Flame size={16} />
                {g.crunch ? `Crunching for ${g.crunchDays} days` : 'Normal hours'}
              </span>
              <Button size="sm" variant={g.crunch ? 'secondary' : 'danger'} onClick={() => act((world) => setCrunch(world, g.id, !g.crunch))}>
                {g.crunch ? 'End crunch' : 'Start crunch'}
              </Button>
            </div>
          </Card>
          <Marketing g={g} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ live

type Metric = 'ccu' | 'active' | 'revenue';

function LiveView({ g }: { g: Game }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const [metric, setMetric] = useState<Metric>('ccu');
  const live = g.status === 'released';
  const devCost = g.budgetSpent + g.staffCost + g.marketingSpent;
  const profit = g.revenueTotal - g.costTotal - devCost;
  const idx = metric === 'ccu' ? 2 : metric === 'active' ? 1 : 3;
  const series = useMemo(
    () => [{ key: metric, name: metric === 'ccu' ? 'Players online' : metric === 'active' ? 'Active players' : 'Daily revenue', color: metric === 'revenue' ? '#199e70' : '#3987e5', data: g.history.map((h) => [h[0], h[idx]] as [number, number]) }],
    [g.history, g.history.length, metric, idx],
  );
  const rivals = Object.values(w.games)
    .filter((x) => x.status === 'released' && x.genre === g.genre)
    .sort((a, b) => b.ccu - a.ccu);
  const rank = rivals.findIndex((x) => x.id === g.id) + 1;
  const ip = w.ips[g.ipId];
  const ipBusy = ip?.games.some((gid) => w.games[gid]?.status === 'development');
  const online = g.multiplayer === 'online' || g.multiplayer === 'massive';

  return (
    <div>
      <Header
        g={g}
        actions={
          <>
            <Button disabled={ipBusy} onClick={() => navigate({ name: 'create', ipId: g.ipId })}>
              <Copy size={14} /> Make sequel
            </Button>
            {!g.remasterOf && !g.remastered && (
              <Button
                disabled={!!remasterBlocker(w, g)}
                title={remasterBlocker(w, g) ?? 'Rebuild this classic with modern tech: 40% of the work, nostalgia hype included'}
                onClick={() => {
                  const r = act((world) => startRemaster(world, g.id), 'Remaster announced');
                  if (r.ok && r.id) navigate({ name: 'game', id: r.id });
                }}
              >
                <Sparkles size={14} /> Remaster
              </Button>
            )}
            {live && (
              <ConfirmButton size="md" confirmLabel="Stop earning from it? Click again" onConfirm={() => act((world) => shutdownServers(world, g.id))}>
                <Power size={14} /> {online ? 'Shut down servers' : 'End support'}
              </ConfirmButton>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat
          label="Players online"
          icon={live ? <span className="live-dot" style={{ width: 6, height: 6 }} /> : undefined}
          value={live ? <LiveNumber value={g.ccu} format={(n) => Math.round(n).toLocaleString()} /> : 'offline'}
          sub={`peak ${num(g.peakCcu)}`}
        />
        <Stat label="Active players" value={num(g.active)} sub={`${num(g.dailyNew)} new today`} />
        <Stat label={MONETIZATIONS[g.monetization].upfront ? 'Copies sold' : 'Total players'} value={num(g.owners)} sub={g.dlcOwners > 0 ? `${num(g.dlcOwners)} DLC buyers` : undefined} />
        <Stat label="Revenue (30d)" value={money(g.rev30)} tone="good" sub={`today ${money(g.dailyRevenue)}`} />
        <Stat label="Lifetime revenue" value={money(g.revenueTotal)} sub={`servers ${money(g.costTotal)}`} />
        <Stat label="Lifetime profit" value={money(profit)} tone={profit >= 0 ? 'good' : 'bad'} sub={`dev cost ${money(devCost)}`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Performance"
          actions={
            <Tabs<Metric>
              value={metric}
              onChange={setMetric}
              tabs={[
                { id: 'ccu', label: 'Online' },
                { id: 'active', label: 'Active' },
                { id: 'revenue', label: 'Revenue' },
              ]}
            />
          }
        >
          <TimeChart series={series} format={metric === 'revenue' ? (n) => money(n) : (n) => num(n)} height={250} />
        </Card>
        <Card title="Reception">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <ScoreBadge score={g.criticScore} />
              <div className="mt-1 text-[11px] text-muted">Critics</div>
            </div>
            <div className="text-center">
              <ScoreBadge score={g.userScore} />
              <div className="mt-1 text-[11px] text-muted">Players</div>
            </div>
            <div className="hidden text-xs font-medium text-sub sm:block">{reviewLabel(g.userScore, g.owners)}</div>
            <div className="flex-1 text-xs text-muted">
              Player score is heading toward <span className="font-semibold text-sub">{Math.round(g.userScoreTarget)}</span>
              {g.userScoreTarget < g.userScore - 2 ? ' (bugs and monetization are hurting it)' : g.userScoreTarget > g.userScore + 2 ? ' (updates are winning players over)' : ''}.
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-sub">Content freshness</span>
                <span className="tabular text-muted">{pct(Math.min(1, g.freshness))}</span>
              </div>
              <Progress value={Math.min(1, g.freshness)} tone={g.freshness > 0.5 ? 'good' : g.freshness > 0.25 ? 'warn' : 'bad'} />
            </div>
            <Kv k="Released" v={date(g.releaseDay ?? 0)} />
            <Kv k="Hype" v={Math.round(g.hype)} />
            <Kv k="Known bugs" v={`${Math.round(g.bugs)} (${bugDensity(g).toFixed(1)}/100)`} tone={bugDensity(g) > 4 ? 'bad' : undefined} />
            <Kv k={`${GENRES[g.genre].name} ranking`} v={rank > 0 ? `#${rank} of ${rivals.length}` : '—'} />
            <Kv k="Overall rating" v={pct(ratingOf(g))} />
            {w.day < g.viralUntil && <Badge tone="good">Going viral!</Badge>}
            {w.day < g.seasonalUntil && <Badge tone="accent">Seasonal event live</Badge>}
            {g.discountUntil > w.day && <Badge tone="warn">{pct(g.discount)} off sale</Badge>}
          </div>
        </Card>
      </div>

      {live && <HealthStrip g={g} />}
      <CriticsCard g={g} />
      <PlayerReviews g={g} />

      {live && (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <UpdatePanel g={g} />
          <div className="space-y-4">
            <Pricing g={g} />
            <Marketing g={g} />
          </div>
          <Card title={`Top ${GENRES[g.genre].name} games`} subtitle="By players online right now" pad={false}>
            <div className="divide-y divide-line-soft">
              {rivals.slice(0, 8).map((x, i) => (
                <div key={x.id} className={cx('flex items-center gap-2 px-4 py-2 text-sm', x.id === g.id && 'bg-accent-soft/40')}>
                  <span className="w-5 text-xs text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{x.title}</div>
                    <div className="truncate text-[11px] text-muted">{w.companies[x.companyId]?.name}</div>
                  </div>
                  <span className="tabular text-sub">{num(x.ccu)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {g.updates.length > 0 && (
        <Card className="mt-4" title="Update history" pad={false}>
          <div className="divide-y divide-line-soft">
            {[...g.updates].reverse().map((u, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Wrench size={14} className="text-muted" />
                <span className="flex-1">{u.label}</span>
                <span className="text-xs text-muted">{date(u.day)}</span>
                <ScoreBadge score={u.reception} label="Reception" />
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}

/** At-a-glance health of a live game: retention, update cadence, servers and mood. */
function HealthStrip({ g }: { g: Game }) {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const sinceUpdate = w.day - g.lastUpdateDay;
  const retention30 = Math.pow(1 - Math.min(0.5, g.lastChurn || 0), 30);
  const online = isOnline(g);
  const fx = online ? infraEffects(w) : null;
  const neglectAfter = !MONETIZATIONS[g.monetization].upfront || online ? 100 : 160;
  const backlash = w.day < g.backlashUntil;
  const down = w.day < g.meltdownUntil;
  const items: { label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; hint: string; onClick?: () => void }[] = [
    {
      label: '30-day retention',
      value: pct(retention30),
      tone: retention30 >= 0.6 ? 'good' : retention30 >= 0.35 ? 'warn' : 'bad',
      hint: `${pct(g.lastChurn || 0, 2)} of active players leave each day`,
    },
    {
      label: 'Last update',
      value: sinceUpdate <= 0 ? 'today' : `${sinceUpdate} days ago`,
      tone: g.active < 2000 ? 'neutral' : sinceUpdate > neglectAfter ? 'bad' : sinceUpdate > neglectAfter * 0.7 ? 'warn' : 'good',
      hint: g.active < 2000 ? 'Small games are not expected to update often' : sinceUpdate > neglectAfter ? 'Players feel abandoned: reviews are slipping' : `Players expect an update every ~${neglectAfter} days`,
    },
    {
      label: 'Community mood',
      value: backlash ? 'Backlash' : g.goodwill > 4 ? 'Loving it' : g.goodwill < -3 ? 'Frustrated' : 'Steady',
      tone: backlash || g.goodwill < -3 ? 'bad' : g.goodwill > 4 ? 'good' : 'neutral',
      hint: backlash ? `Churn is up for ${g.backlashUntil - w.day} more days after a poorly received update` : 'Good updates and fixes build goodwill',
    },
  ];
  if (online && fx) {
    items.push({
      label: 'Servers',
      value: down ? 'Outage' : fx.overloaded ? 'Overloaded' : 'Healthy',
      tone: down || fx.overloaded ? 'bad' : 'good',
      hint: down ? 'Players cannot connect' : fx.overloaded ? 'New players are turned away. Add capacity.' : `${pct(w.player.infra.load)} load across your fleet`,
      onClick: () => navigate({ name: 'servers' }),
    });
  }
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <button
          key={it.label}
          onClick={it.onClick}
          disabled={!it.onClick}
          className={cx('rounded-xl border bg-surface px-4 py-3 text-left disabled:cursor-default', it.tone === 'bad' ? 'border-bad/40' : it.tone === 'warn' ? 'border-warn/40' : 'border-line', it.onClick && 'card-hover')}
        >
          <div className="text-xs text-muted">{it.label}</div>
          <div className={cx('mt-0.5 text-lg font-semibold', it.tone === 'good' ? 'text-good' : it.tone === 'warn' ? 'text-warn' : it.tone === 'bad' ? 'text-bad' : 'text-ink')}>{it.value}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted">{it.hint}</div>
        </button>
      ))}
    </div>
  );
}

function CriticsCard({ g }: { g: Game }) {
  const reviews = criticReviews(g, 5);
  if (reviews.length === 0) return null;
  return (
    <Card className="mt-4" title="What the critics say" subtitle={`Metascore ${g.criticScore}`}>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {reviews.map((r) => (
          <div key={r.outlet} className="flex flex-col rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-sub">{r.outlet}</span>
              <ScoreBadge score={r.score} />
            </div>
            <p className="mt-2 flex-1 text-sm leading-snug">"{r.quote}"</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlayerReviews({ g }: { g: Game }) {
  const w = useWorld();
  const reviews = playerReviews(w, g, 4);
  if (reviews.length === 0) return null;
  const label = reviewLabel(g.userScore, g.owners);
  return (
    <Card className="mt-4" title="What players are saying" subtitle={`${label} · ${num(g.owners)} ${MONETIZATIONS[g.monetization].upfront ? 'owners' : 'players'}`}>
      <div className="grid gap-2 md:grid-cols-2">
        {reviews.map((r) => (
          <div key={r.text} className="rounded-lg border border-line bg-surface-2 p-3">
            <div className={cx('flex items-center gap-1.5 text-xs font-semibold', r.recommended ? 'text-good' : 'text-bad')}>
              {r.recommended ? <ThumbsUp size={13} /> : <ThumbsDown size={13} />}
              {r.recommended ? 'Recommended' : 'Not recommended'}
              <span className="ml-auto font-normal text-muted">{r.hours} h played</span>
            </div>
            <p className="mt-1.5 text-sm leading-snug text-ink">"{r.text}"</p>
            <div className="mt-1.5 text-[11px] text-muted">{r.helpful} people found this helpful</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

type TeamMode = 'idle' | 'everyone' | 'pick';

function UpdatePanel({ g }: { g: Game }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const devs = w.player.employees.filter((e) => ROLES[e.role].dev);
  const idle = devs.filter((e) => !e.assignment || e.assignment === g.id);
  const [basket, setBasket] = useState<UpdateTypeId[]>(['content']);
  const [platform, setPlatform] = useState<PlatformId | ''>('');
  const [mon, setMon] = useState<MonetizationId>(g.monetization);
  const [mode, setMode] = useState<TeamMode>(idle.length > 0 ? 'idle' : 'everyone');
  const [picked, setPicked] = useState<string[]>([]);
  const running = g.update;
  const onGame = w.player.employees.filter((e) => e.assignment === g.id);
  const portOptions = PLATFORM_IDS.filter((p) => !g.platforms.includes(p));

  const team = running ? onGame : mode === 'everyone' ? devs : mode === 'idle' ? idle : devs.filter((e) => picked.includes(e.id));
  const daily = playerDailyWork(w, g, team);
  const items = basket.map((t) => ({ type: t, platform: t === 'port' ? platform || undefined : undefined, monetization: t === 'monetization' ? mon : undefined }));
  const cost = items.reduce((s, it) => s + updateCost(g, it.type, it.platform), 0);
  const work = items.reduce((s, it) => s + updateWork(w, g, it.type, true, it.platform), 0);
  const pulledFromProjects = !running && mode === 'everyone' && devs.some((e) => e.assignment && e.assignment !== g.id && w.games[e.assignment]?.status === 'development');
  const toggle = (t: UpdateTypeId) => setBasket(basket.includes(t) ? basket.filter((x) => x !== t) : [...basket, t]);

  const submit = () => {
    const ids = running ? [] : team.map((e) => e.id);
    const r = act((world) => queueUpdates(world, g.id, items, ids), running ? 'Added to the update queue' : `${items.length} update${items.length > 1 ? 's' : ''} started`);
    if (r.ok) setBasket([]);
  };

  return (
    <Card title="Updates" subtitle="Pick one or more updates. They run back to back with the same team.">
      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
        <input id={`auto-${g.id}`} type="checkbox" className="mt-1" checked={isAutoUpdated(w, g)} onChange={(e) => act((world) => setAutoUpdates(world, g.id, e.target.checked))} />
        <span>
          <span className="block text-sm font-medium">Auto-update this game</span>
          <span className="block text-xs text-muted">
            Your live-ops team ships hotfixes, content, events, expansions and ports on its own{w.player.liveOps.crew ? ', with contractors when your developers are busy' : ', borrowing a few developers when needed'}.
          </span>
          <span className="mt-1 block text-xs text-sub">
            {versionLabel(g)} · size level {contentLevelOf(g)}
            {contentLevelOf(g) > 0 && ` · +${Math.round(contentLevelOf(g) * 2)}% new players, -${contentLevelOf(g)}% churn`}
            {contentLevelOf(g) >= MAX_CONTENT_LEVEL && ' (max)'}
          </span>
        </span>
      </label>

      {running && (
        <div className="mb-4 rounded-lg border border-accent/40 bg-accent-soft/30 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{UPDATES[running.type].name}</span>
            <span className="tabular text-sub">{Math.round((running.workDone / running.workRequired) * 100)}%</span>
          </div>
          <Progress value={running.workDone} max={running.workRequired} className="mt-2" />
          <div className="mt-2 text-xs text-muted">
            {onGame.length} on the team{running.aiTeam ? ` + ${num(running.aiTeam)} contractors` : ''}
            {daily + running.aiTeam * CREW_OUTPUT > 0 ? ` · about ${days(Math.max(0, running.workRequired - running.workDone) / (daily + running.aiTeam * CREW_OUTPUT))} left` : ' · stalled, nobody assigned'}
          </div>
          {g.updateQueue.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted">Up next</div>
              {g.updateQueue.map((q, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-surface-2 px-2 py-1 text-xs">
                  <span>
                    {i + 1}. {UPDATES[q.type].name}
                    {q.platform ? ` · ${PLATFORMS[q.platform].name}` : ''}
                  </span>
                  <button onClick={() => act((world) => removeQueuedUpdate(world, g.id, i))} className="text-muted hover:text-bad" aria-label="Remove from queue">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => act((world) => assignDevs(world, g.id, 'idle'), 'Idle developers joined the update')}>
              <Users size={13} /> Add idle devs
            </Button>
            <Button size="sm" onClick={() => act((world) => assignDevs(world, g.id, 'everyone'), 'The whole studio is on this update')}>
              Whole studio
            </Button>
            <Button size="sm" variant="danger" onClick={() => act((world) => cancelUpdate(world, g.id))}>
              Cancel all
            </Button>
          </div>
        </div>
      )}

      <div className="text-xs font-medium text-sub">{running ? 'Queue more updates' : 'Choose updates'}</div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {UPDATE_IDS.map((t) => {
          const on = basket.includes(t);
          const tired = updateFatigue(w, g, t);
          return (
            <button
              key={t}
              onClick={() => toggle(t)}
              title={tired > 0 ? `Players are tired of these: -${tired} reception` : UPDATES[t].blurb}
              className={cx('flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left', on ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface-2 hover:border-sub')}
            >
              <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]', on ? 'border-accent bg-accent text-white' : 'border-line')}>{on ? basket.indexOf(t) + 1 : ''}</span>
              <span className="flex-1 text-xs font-semibold">{UPDATES[t].name}</span>
              {tired > 0 && <span className="text-[10px] font-medium text-warn">−{tired}</span>}
            </button>
          );
        })}
      </div>
      {basket.length === 1 && <p className="mt-2 text-xs text-muted">{UPDATES[basket[0]].blurb}</p>}
      {basket.includes('port') && (
        <select id={`port-${g.id}`} className={cx(inputClass, 'mt-2')} value={platform} onChange={(e) => setPlatform(e.target.value as PlatformId)}>
          <option value="">Port to which platform?</option>
          {portOptions.map((p) => (
            <option key={p} value={p} disabled={c.reputation < PLATFORMS[p].minRep}>
              {PLATFORMS[p].name} {c.reputation < PLATFORMS[p].minRep ? `(rep ${PLATFORMS[p].minRep})` : ''}
            </option>
          ))}
        </select>
      )}
      {basket.includes('monetization') && (
        <select id={`mon-${g.id}`} className={cx(inputClass, 'mt-2')} value={mon} onChange={(e) => setMon(e.target.value as MonetizationId)}>
          {MONETIZATION_IDS.map((m) => (
            <option key={m} value={m}>
              {m === g.monetization ? `${MONETIZATIONS[m].name} (keep: new battle pass season)` : MONETIZATIONS[m].name}
            </option>
          ))}
        </select>
      )}

      {!running && (
        <>
          <div className="mt-3 text-xs font-medium text-sub">Who works on it</div>
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface p-1">
            {(
              [
                ['idle', `Idle (${idle.length})`],
                ['everyone', `Everyone (${devs.length})`],
                ['pick', 'Pick'],
              ] as [TeamMode, string][]
            ).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} className={cx('rounded-md px-2 py-1.5 text-xs font-medium', mode === m ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
          {pulledFromProjects && <p className="mt-1.5 text-[11px] text-warn">Games in development pause while everyone works on the update.</p>}
          {mode === 'pick' && (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {devs.map((e: Employee) => {
                const on = picked.includes(e.id);
                const busy = e.assignment && e.assignment !== g.id ? w.games[e.assignment] : null;
                return (
                  <button key={e.id} onClick={() => setPicked(on ? picked.filter((x) => x !== e.id) : [...picked, e.id])} className={cx('flex w-full items-center justify-between rounded-md border px-2 py-1 text-xs', on ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2')}>
                    <span>{e.name}</span>
                    <span className="text-muted">
                      {e.isFounder ? 'Founder' : ROLES[e.role].name} · {Math.round(e.skill)}
                      {busy ? ` · on ${busy.title}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="mt-3 rounded-lg bg-surface-2 px-3 py-1.5">
        <Kv k="Cost" v={money(cost)} tone={cost > c.cash ? 'bad' : undefined} />
        <Kv k="Time" v={daily > 0 && basket.length ? days(work / daily) : '—'} />
      </div>
      <Button variant="primary" className="mt-3 w-full" disabled={basket.length === 0 || team.length === 0 || c.cash < cost || (basket.includes('port') && !platform)} onClick={submit}>
        <Wrench size={14} />
        {basket.length === 0 ? 'Pick an update' : running ? `Add ${basket.length} to queue` : basket.length > 1 ? `Start ${basket.length} updates` : 'Start update'}
      </Button>
      {!running && team.length === 0 && <p className="mt-2 text-xs text-warn">Nobody selected. Choose Everyone or hire developers.</p>}
    </Card>
  );
}

function Pricing({ g }: { g: Game }) {
  const act = useGameStore((s) => s.act);
  const w = useWorld();
  const [price, setPriceInput] = useState(g.price);
  if (!MONETIZATIONS[g.monetization].upfront) {
    return (
      <Card title="Pricing">
        <div className="flex items-center gap-2 text-sm text-sub">
          <Tag size={15} /> Free to play — monetized through {MONETIZATIONS[g.monetization].name.toLowerCase()}.
        </div>
      </Card>
    );
  }
  const saleOn = g.discountUntil > w.day;
  return (
    <Card title="Pricing" subtitle={`Players expect about $${SCOPES[g.scope].price} for this scope`}>
      <div className="flex gap-2">
        <input type="number" min={0.99} max={99.99} step={1} className={inputClass} value={price} onChange={(e) => setPriceInput(Number(e.target.value))} />
        <Button onClick={() => act((world) => setPrice(world, g.id, price), 'Price updated')}>Set</Button>
      </div>
      <div className="mt-3 text-xs font-medium text-sub">{saleOn ? `Sale running until ${date(g.discountUntil)}` : 'Run a sale'}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {[0.25, 0.5, 0.75].map((d) => (
          <Button key={d} size="sm" disabled={saleOn} onClick={() => act((world) => startDiscount(world, g.id, d, 10), `${pct(d)} sale started`)}>
            -{pct(d)} for 10 days
          </Button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        <Bug size={11} className="mr-1 inline" />
        Sales spike purchases from players who found the price too high.
      </p>
    </Card>
  );
}
