import { useState } from 'react';
import { BriefcaseBusiness, CalendarClock, Copy, Gamepad2, Plus, RefreshCcw, Users } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { GENRES, MONETIZATIONS, PLATFORMS, ROLES, SCOPES } from '../../engine/constants';
import { MAX_CONTRACTS, abandonContract, acceptContract, contractDailyWork, contractTeam, staffContract, teamContractWork } from '../../engine/contracts';
import type { ContractOffer } from '../../engine/types';
import { playerCompany } from '../../engine/util';
import type { Game } from '../../engine/types';
import { date, days, money, num } from '../lib/format';
import { statusLabel } from '../lib/selectors';
import { setLiveOps } from '../../engine/actions';
import { isAutoUpdated } from '../../engine/automation';
import { contentLevelOf } from '../../engine/updates';
import { Sparkline } from '../components/charts';
import { Badge, Button, Card, ConfirmButton, Empty, LiveNumber, Progress, ScoreBadge, SectionTitle, Tabs, Td, Th, cx } from '../components/ui';

type Tab = 'dev' | 'live' | 'contracts' | 'all' | 'ips';

export function Projects() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const c = playerCompany(w);
  const [tab, setTab] = useState<Tab>('dev');
  const mine = Object.values(w.games).filter((g) => g.companyId === c.id);
  const dev = mine.filter((g) => g.status === 'development');
  const live = mine.filter((g) => g.status === 'released').sort((a, b) => b.ccu - a.ccu);
  const all = [...mine].filter((g) => g.status !== 'cancelled').sort((a, b) => (b.releaseDay ?? b.createdDay) - (a.releaseDay ?? a.createdDay));
  const ips = Object.values(w.ips).filter((ip) => ip.companyId === c.id && ip.games.some((id) => w.games[id]?.releaseDay !== null));
  const subs = Object.values(w.companies).filter((x) => x.parentId === c.id && x.status === 'active');
  const subGames = Object.values(w.games).filter((g) => subs.some((s) => s.id === g.companyId) && g.status === 'released');

  return (
    <div>
      <SectionTitle
        actions={
          <Button variant="primary" onClick={() => navigate({ name: 'create' })}>
            <Plus size={15} /> New game
          </Button>
        }
      >
        Studio
      </SectionTitle>
      <div className="mb-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'dev', label: `In development (${dev.length})` },
            { id: 'live', label: `Live (${live.length})` },
            { id: 'contracts', label: `Contracts (${w.player.contracts.length})` },
            { id: 'all', label: `Catalogue (${all.length})` },
            { id: 'ips', label: `Franchises (${ips.length})` },
          ]}
        />
      </div>

      {tab === 'dev' &&
        (dev.length === 0 ? (
          <Empty icon={<Gamepad2 size={30} />} title="No games in development">
            Start a new project. Small teams should start with Tiny or Small scope.
            <div className="mt-3">
              <Button variant="primary" onClick={() => navigate({ name: 'create' })}>
                <Plus size={15} /> New game
              </Button>
            </div>
          </Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dev.map((g) => {
              const team = w.player.employees.filter((e) => e.assignment === g.id);
              const pctDone = g.workDone / g.workRequired;
              return (
                <button key={g.id} onClick={() => navigate({ name: 'game', id: g.id })} className="rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{g.title}</div>
                      <div className="text-xs text-muted">
                        {SCOPES[g.scope].name} {GENRES[g.genre].name} · {g.platforms.map((p) => PLATFORMS[p].name).join(', ')}
                      </div>
                    </div>
                    <Badge tone={pctDone >= 1 ? 'good' : 'accent'}>{statusLabel(g)}</Badge>
                  </div>
                  <Progress value={g.workDone} max={g.workRequired} tone={pctDone >= 1 ? 'good' : 'accent'} className="mt-3" height={8} />
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted">Progress</div>
                      <div className="font-semibold tabular">{Math.min(100, Math.round(pctDone * 100))}%</div>
                    </div>
                    <div>
                      <div className="text-muted">Team</div>
                      <div className={team.length ? 'font-semibold' : 'font-semibold text-bad'}>{team.length || 'none!'}</div>
                    </div>
                    <div>
                      <div className="text-muted">Hype</div>
                      <div className="font-semibold tabular">{Math.round(g.hype)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}

      {tab === 'live' && (
        <div className="space-y-4">
          <LiveOpsCard games={live} />
          <GameTable games={live} empty="No live games yet." />
        </div>
      )}
      {tab === 'contracts' && <Contracts />}
      {tab === 'all' && <GameTable games={all} empty="Your catalogue is empty." />}
      {tab === 'ips' &&
        (ips.length === 0 ? (
          <Empty title="No franchises yet">Every released game founds an IP. Successful IPs build fans that boost sequels.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ips.map((ip) => {
              const games = ip.games.map((id) => w.games[id]).filter(Boolean);
              const busy = games.some((g) => g.status === 'development');
              const best = Math.max(...games.map((g) => g.criticScore));
              return (
                <Card key={ip.id} title={ip.name} subtitle={`${games.length} game${games.length > 1 ? 's' : ''} · ${num(ip.fans)} fans`}>
                  <div className="space-y-1 text-sm">
                    {games.map((g) => (
                      <button key={g.id} onClick={() => navigate({ name: 'game', id: g.id })} className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-2">
                        <span className="truncate">{g.title}</span>
                        {g.releaseDay !== null ? <ScoreBadge score={g.criticScore} /> : <Badge tone="accent">in dev</Badge>}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" className="mt-3 w-full" disabled={busy} onClick={() => navigate({ name: 'create', ipId: ip.id })} title={busy ? 'A game in this franchise is already in development' : undefined}>
                    <Copy size={13} /> Make a sequel {best >= 75 ? '(fans are waiting!)' : ''}
                  </Button>
                </Card>
              );
            })}
          </div>
        ))}

      {subs.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-sub">Subsidiary games ({subGames.length} live)</h2>
          <GameTable games={subGames.sort((a, b) => b.ccu - a.ccu).slice(0, 20)} empty="" showStudio />
        </div>
      )}
    </div>
  );
}

function GameTable({ games, empty, showStudio }: { games: Game[]; empty: string; showStudio?: boolean }) {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  if (games.length === 0) return <Empty title={empty} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full">
        <thead className="border-b border-line-soft">
          <tr>
            <Th>Game</Th>
            {showStudio && <Th>Studio</Th>}
            <Th>Status</Th>
            <Th className="text-center">Critic</Th>
            <Th className="text-center">Users</Th>
            <Th className="text-right">Online</Th>
            <Th className="text-right">Active</Th>
            <Th className="text-right">Owners</Th>
            <Th>90 days</Th>
            <Th className="text-right">Rev 30d</Th>
            <Th className="text-right">Lifetime</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {games.map((g) => (
            <tr
              key={g.id}
              onClick={() => (g.companyId === w.player.companyId ? navigate({ name: 'game', id: g.id }) : navigate({ name: 'company', id: g.companyId }))}
              className="cursor-pointer hover:bg-surface-2"
            >
              <Td>
                <div className="font-medium">{g.title}</div>
                <div className="text-xs text-muted">
                  {GENRES[g.genre].name} · {MONETIZATIONS[g.monetization].short}
                </div>
              </Td>
              {showStudio && <Td className="text-sub">{w.companies[g.companyId]?.name}</Td>}
              <Td>
                <Badge tone={g.status === 'released' ? 'good' : g.status === 'development' ? 'accent' : 'neutral'}>{statusLabel(g)}</Badge>
              </Td>
              <Td className="text-center">{g.releaseDay !== null ? <ScoreBadge score={g.criticScore} /> : '—'}</Td>
              <Td className="text-center">{g.releaseDay !== null ? <ScoreBadge score={g.userScore} /> : '—'}</Td>
              <Td className="text-right font-semibold">{g.status === 'released' ? <LiveNumber value={g.ccu} format={(n) => Math.round(n).toLocaleString()} /> : '—'}</Td>
              <Td className="text-right tabular text-sub">{num(g.active)}</Td>
              <Td className="text-right tabular text-sub">{num(g.owners)}</Td>
              <Td>
                <Sparkline data={g.history.slice(-90).map((h) => h[2])} color={g.status === 'released' ? '#3987e5' : '#5b6878'} />
              </Td>
              <Td className="text-right tabular">{money(g.rev30)}</Td>
              <Td className="text-right tabular">{money(g.revenueTotal)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------ contracts

function Contracts() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const idle = w.player.employees.filter((e) => ROLES[e.role].dev && !e.assignment);
  const full = w.player.contracts.length >= MAX_CONTRACTS;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 text-sm text-sub">
        Work-for-hire keeps the lights on between your own games. Deliver on time for full pay and reputation; late work earns half. Blow the deadline by a month and the client walks.
        {w.player.autoAssign && <span className="text-muted"> Auto-assign sends idle developers to contracts that are falling behind.</span>}
      </div>
      {w.player.contracts.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {w.player.contracts.map((k) => {
            const team = contractTeam(w, k.id);
            const daily = contractDailyWork(w, k.id);
            const left = Math.max(0, k.work - k.workDone);
            const eta = daily > 0 ? left / daily : Infinity;
            const dueIn = k.deadline - w.day;
            const late = w.day + eta > k.deadline;
            return (
              <Card key={k.id} title={k.title} subtitle={`${k.client} · ${money(k.pay)}`}>
                <Progress value={k.workDone} max={k.work} tone={late ? 'warn' : 'accent'} height={8} />
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted">Progress</div>
                    <div className="font-semibold tabular">{Math.round((k.workDone / k.work) * 100)}%</div>
                  </div>
                  <div>
                    <div className="text-muted">Due</div>
                    <div className={cx('font-semibold tabular', dueIn < 0 ? 'text-bad' : dueIn < 10 ? 'text-warn' : '')}>{dueIn >= 0 ? `${dueIn}d` : `${-dueIn}d late`}</div>
                  </div>
                  <div>
                    <div className="text-muted">Finish</div>
                    <div className={cx('font-semibold', late ? 'text-warn' : 'text-good')}>{Number.isFinite(eta) ? `~${days(eta)}` : 'stalled'}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted">
                  <Users size={11} className="mr-1 inline" />
                  {team.length ? team.map((e) => e.name.split(' ')[0]).join(', ') : 'Nobody assigned'}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={idle.length === 0} onClick={() => act((world) => staffContract(world, k.id, idle.map((e) => e.id)), 'Idle developers joined the contract')}>
                    <Users size={12} /> Add idle ({idle.length})
                  </Button>
                  <ConfirmButton confirmLabel="Lose reputation? Confirm" onConfirm={() => act((world) => abandonContract(world, k.id))}>
                    Abandon
                  </ConfirmButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Card title="Offers" subtitle={`New offers every month${full ? ` · you are running the maximum of ${MAX_CONTRACTS}` : ''}`}>
        {w.player.contractOffers.length === 0 ? (
          <Empty icon={<BriefcaseBusiness size={24} />} title="No offers right now">New clients get in touch at the start of each month.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {w.player.contractOffers.map((o) => (
              <OfferCard key={o.id} o={o} disabled={full} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function OfferCard({ o, disabled }: { o: ContractOffer; disabled: boolean }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const devs = w.player.employees.filter((e) => ROLES[e.role].dev);
  const idle = devs.filter((e) => !e.assignment);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>(() => (idle.length ? idle : devs.slice(0, 1)).map((e) => e.id));
  const team = devs.filter((e) => picked.includes(e.id));
  const daily = teamContractWork(w, team);
  const eta = daily > 0 ? o.work / daily : Infinity;
  const ok = eta <= o.days;
  return (
    <div className="flex flex-col rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{o.title}</div>
          <div className="text-xs text-muted">{o.client}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-good tabular">{money(o.pay)}</div>
          <div className="text-[11px] text-muted">+{o.rep} rep</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>
          <CalendarClock size={11} className="mr-0.5 inline" /> {o.days} days
        </span>
        <span>{num(o.work)} work</span>
        <span>offer ends {date(o.expiresDay)}</span>
      </div>
      <div className={cx('mt-2 text-xs', ok ? 'text-good' : 'text-warn')}>
        {team.length === 0 ? 'Pick at least one developer' : Number.isFinite(eta) ? `${team.length} dev${team.length > 1 ? 's' : ''}: about ${days(eta)}${ok ? ', on time' : ', would be late'}` : 'Too slow'}
      </div>
      {picking && (
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
          {devs.map((e) => {
            const on = picked.includes(e.id);
            const busy = e.assignment ? (w.games[e.assignment]?.title ?? 'a contract') : null;
            return (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-3">
                <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== e.id) : [...picked, e.id])} />
                <span className="flex-1 truncate">{e.name}</span>
                <span className="text-muted">{busy ? `on ${busy}` : 'idle'}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" className="flex-1" disabled={disabled || team.length === 0} onClick={() => act((world) => acceptContract(world, o.id, picked), `Contract signed with ${o.client}`)}>
          Accept
        </Button>
        <Button size="sm" onClick={() => setPicking(!picking)}>
          <Users size={12} /> {picking ? 'Done' : `Team (${team.length})`}
        </Button>
      </div>
    </div>
  );
}

function LiveOpsCard({ games }: { games: Game[] }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const lo = w.player.liveOps;
  const auto = games.filter((g) => isAutoUpdated(w, g));
  const updating = games.filter((g) => g.update);
  const contractors = updating.reduce((s, g) => s + (g.update?.aiTeam ?? 0), 0);
  const avgSize = auto.length ? auto.reduce((s, g) => s + contentLevelOf(g), 0) / auto.length : 0;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <RefreshCcw size={15} className="text-accent" /> Live-ops autopilot
        </span>
      }
      subtitle="Your games keep growing on their own: content drops, events, expansions and ports to new platforms. Every content update makes a game bigger, so more players find it and fewer leave."
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid gap-2 sm:grid-cols-2">
          <label htmlFor="liveops-auto" className={cx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', lo.auto ? 'border-accent/60 bg-accent-soft/30' : 'border-line bg-surface-2')}>
            <input id="liveops-auto" type="checkbox" className="mt-1" checked={lo.auto} onChange={(e) => act((world) => setLiveOps(world, { auto: e.target.checked }))} />
            <span>
              <span className="block text-sm font-medium">Auto-update every game</span>
              <span className="block text-xs text-muted">Skips games that earn less than an update costs. You can still switch single games off.</span>
            </span>
          </label>
          <label htmlFor="liveops-crew" className={cx('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', lo.crew ? 'border-accent/60 bg-accent-soft/30' : 'border-line bg-surface-2')}>
            <input id="liveops-crew" type="checkbox" className="mt-1" checked={lo.crew} onChange={(e) => act((world) => setLiveOps(world, { crew: e.target.checked }))} />
            <span>
              <span className="block text-sm font-medium">Hire a live-ops crew</span>
              <span className="block text-xs text-muted">Contractors join each update so it ships on time (about a month for content) without pulling developers off new games.</span>
            </span>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-surface-2 p-2">
            <div className="text-lg font-semibold tabular">{auto.length}</div>
            <div className="text-[11px] text-muted">auto-updated</div>
          </div>
          <div className="rounded-lg bg-surface-2 p-2">
            <div className="text-lg font-semibold tabular">{updating.length}</div>
            <div className="text-[11px] text-muted">updating now{contractors ? ` · ${num(contractors)} contractors` : ''}</div>
          </div>
          <div className="rounded-lg bg-surface-2 p-2">
            <div className="text-lg font-semibold tabular">{avgSize.toFixed(1)}</div>
            <div className="text-[11px] text-muted">average size level</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
