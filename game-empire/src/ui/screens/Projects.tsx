import { useState } from 'react';
import { Copy, Gamepad2, Plus } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { GENRES, MONETIZATIONS, PLATFORMS, SCOPES } from '../../engine/constants';
import { playerCompany } from '../../engine/util';
import type { Game } from '../../engine/types';
import { money, num } from '../lib/format';
import { statusLabel } from '../lib/selectors';
import { Sparkline } from '../components/charts';
import { Badge, Button, Card, Empty, LiveNumber, Progress, ScoreBadge, SectionTitle, Tabs, Td, Th } from '../components/ui';

type Tab = 'dev' | 'live' | 'all' | 'ips';

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

      {tab === 'live' && <GameTable games={live} empty="No live games yet." />}
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
