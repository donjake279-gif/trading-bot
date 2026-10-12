import { Activity, ArrowUpCircle, Check, CircleAlert, Gauge, Lock, Minus, Plus, Server, ShieldCheck, Zap } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { SERVER_TIERS } from '../../engine/constants';
import { buyNodes, infraCapacity, infraCostMult, infraEffects, infraMonthlyCost, infraUptime, isOnline, sellNodes, setAutoscale, setServerTier, tierBlocker } from '../../engine/infra';
import { gamesOf, playerCompany } from '../../engine/util';
import { date, money, num, pct } from '../lib/format';
import { TimeChart } from '../components/charts';
import { Badge, Button, Card, Empty, SectionTitle, Stat, Td, Th, cx } from '../components/ui';

function loadTone(load: number): 'good' | 'warn' | 'bad' {
  return load > 1 ? 'bad' : load > 0.85 ? 'warn' : 'good';
}

/** Rough chance of at least one outage in a 30-day month at normal load. */
function monthlyOutageRisk(daily: number): number {
  return 1 - Math.pow(1 - daily, 30);
}

export function LoadGauge({ load, className }: { load: number; className?: string }) {
  const tone = loadTone(load);
  const width = Math.min(100, load * 100);
  return (
    <div className={className}>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className={cx('h-full rounded-full transition-[width] duration-500', tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-warn' : 'bg-good')} style={{ width: `${width}%` }} />
        <span className="absolute inset-y-0 w-px bg-white/30" style={{ left: '85%' }} title="Autoscale threshold" />
      </div>
    </div>
  );
}

export function Servers() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const p = playerCompany(w);
  const i = w.player.infra;
  const tier = SERVER_TIERS[i.tier];
  const cap = infraCapacity(w);
  const fx = infraEffects(w);
  const online = gamesOf(w, p.id).filter((g) => g.status === 'released' && isOnline(g)).sort((a, b) => b.ccu - a.ccu);
  const planned = gamesOf(w, p.id).filter((g) => g.status === 'development' && isOnline(g));
  const monthly = infraMonthlyCost(w);
  const uptime = infraUptime(w);
  const down = w.day < i.outageUntil;
  const nodeCost = tier.nodeCost;

  return (
    <div className="space-y-4">
      <SectionTitle
        actions={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
            <input type="checkbox" checked={i.autoscale} onChange={(e) => act((world) => setAutoscale(world, e.target.checked))} />
            <span>
              <span className="font-medium text-ink">Autoscale</span>
              <span className="ml-1 text-muted">adds nodes at 85% load and moves up a tier when it can</span>
            </span>
          </label>
        }
      >
        Servers
      </SectionTitle>

      {online.length === 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          Your servers host every <strong className="text-ink">online</strong> and <strong className="text-ink">massively multiplayer</strong> game you release. Single-player and local co-op games don't need them.
          {planned.length > 0 ? ` ${planned.length} online game${planned.length > 1 ? 's are' : ' is'} in development. Make sure capacity is ready for launch day.` : ' Make an online game to put them to work.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Tier" value={tier.name} sub={`${i.nodes} / ${tier.maxNodes} nodes`} icon={<Server size={13} />} />
        <Stat label="Capacity" value={num(cap)} sub={`${num(tier.nodeCapacity)} players per node`} icon={<Gauge size={13} />} />
        <Stat
          label="Load"
          value={pct(i.load)}
          tone={loadTone(i.load)}
          sub={down ? 'Outage in progress' : i.load > 1 ? 'Overloaded: players turned away' : `${num(i.demand)} players online`}
          icon={<Activity size={13} />}
        />
        <Stat label="Uptime (90 days)" value={pct(uptime, 1)} tone={uptime >= 0.99 ? 'good' : uptime >= 0.96 ? 'warn' : 'bad'} sub={`${pct(monthlyOutageRisk(tier.outage), 0)} monthly outage risk`} icon={<ShieldCheck size={13} />} />
        <Stat label="Monthly cost" value={money(monthly)} sub={infraCostMult(w) < 1 ? `${pct(1 - infraCostMult(w))} discount from research & perks` : 'Nodes + bandwidth'} icon={<Zap size={13} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Players online vs capacity"
          subtitle={fx.overloaded ? 'Over capacity: fewer new players, more churn, worse reviews.' : 'Stay under the line and your games run smoothly.'}
        >
          <LoadGauge load={i.load} className="mb-3" />
          <TimeChart
            series={[
              { key: 'cap', name: 'Capacity', color: '#5b6878', data: i.capacityHistory },
              { key: 'dem', name: 'Players online', color: '#3987e5', data: i.demandHistory },
            ]}
            format={(n) => num(n)}
            height={220}
          />
        </Card>
        <Card title="Nodes" subtitle={`${tier.name}: ${money(nodeCost)} per node, ${money(tier.nodeMaintenance)}/mo upkeep`}>
          <div className="flex items-center justify-between gap-2">
            <Button onClick={() => act((world) => sellNodes(world, 1))} disabled={i.nodes <= 1} title="Sell one node (30% refund)">
              <Minus size={14} />
            </Button>
            <div className="text-center">
              <div className="text-3xl font-semibold tabular">{i.nodes}</div>
              <div className="text-xs text-muted">of {tier.maxNodes} max</div>
            </div>
            <Button variant="primary" onClick={() => act((world) => buyNodes(world, 1))} disabled={i.nodes >= tier.maxNodes || p.cash < nodeCost} title={`Buy one node (${money(nodeCost)})`}>
              <Plus size={14} />
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => act((world) => buyNodes(world, 5))} disabled={i.nodes >= tier.maxNodes || p.cash < nodeCost * Math.min(5, tier.maxNodes - i.nodes)}>
              +5 nodes
            </Button>
            <Button size="sm" onClick={() => act((world) => sellNodes(world, 5))} disabled={i.nodes <= 1}>
              −5 nodes
            </Button>
          </div>
          <div className="mt-4 space-y-1.5 text-xs text-sub">
            <div className="flex justify-between">
              <span className="text-muted">Bandwidth</span>
              <span className="tabular">{money(tier.bandwidth * 30 * 1000)}/mo per 1K players</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Performance</span>
              <span className="tabular">{pct(tier.performance)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Review bonus</span>
              <span className={cx('tabular', fx.score >= 0 ? 'text-good' : 'text-bad')}>{fx.score >= 0 ? '+' : ''}{fx.score.toFixed(1)} user score</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Server tiers" subtitle="Better tiers carry more players per node, fail less, and make games feel smoother. Your capacity carries over when you move.">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {SERVER_TIERS.map((t, idx) => {
            const current = idx === i.tier;
            const blocker = tierBlocker(w, idx);
            const lockedReason = blocker && !blocker.startsWith('Costs') ? blocker : null;
            return (
              <div key={t.name} className={cx('rounded-lg border p-3', current ? 'border-accent bg-accent-soft/30' : idx < i.tier ? 'border-line-soft bg-surface-2/60' : 'border-line bg-surface-2')}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Server size={14} className={current ? 'text-accent' : 'text-muted'} />
                    {t.name}
                  </div>
                  {current ? <Badge tone="accent">Current</Badge> : idx < i.tier ? <Check size={14} className="text-good" /> : lockedReason ? <Lock size={13} className="text-muted" /> : null}
                </div>
                <p className="mt-1 text-xs text-sub">{t.blurb}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  <span className="text-muted">Per node</span>
                  <span className="text-right tabular">{num(t.nodeCapacity)} players</span>
                  <span className="text-muted">Max capacity</span>
                  <span className="text-right tabular">{num(t.nodeCapacity * t.maxNodes)}</span>
                  <span className="text-muted">Node upkeep</span>
                  <span className="text-right tabular">{money(t.nodeMaintenance)}/mo</span>
                  <span className="text-muted">Outage risk</span>
                  <span className="text-right tabular">{pct(monthlyOutageRisk(t.outage))}/mo</span>
                </div>
                {lockedReason && <div className="mt-2 text-[11px] text-warn">{lockedReason}</div>}
                {!current && (
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    variant={idx > i.tier ? 'primary' : 'secondary'}
                    disabled={!!blocker}
                    onClick={() => act((world) => setServerTier(world, idx))}
                  >
                    {idx > i.tier ? (
                      <>
                        <ArrowUpCircle size={13} /> Upgrade · {money(t.upgradeCost)}
                      </>
                    ) : (
                      'Move down'
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Games on your servers" pad={false}>
          {online.length === 0 ? (
            <div className="p-4">
              <Empty icon={<Server size={22} />} title="No online games live yet" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line-soft">
                    <Th>Game</Th>
                    <Th className="text-right">Online</Th>
                    <Th className="text-right">Share</Th>
                    <Th className="text-right">Server cost / mo</Th>
                  </tr>
                </thead>
                <tbody>
                  {online.map((g) => (
                    <tr key={g.id} className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-surface-2" onClick={() => navigate({ name: 'game', id: g.id })}>
                      <Td className="font-medium">{g.title}</Td>
                      <Td className="text-right tabular">{num(g.ccu)}</Td>
                      <Td className="text-right tabular text-sub">{pct(i.demand > 0 ? g.ccu / i.demand : 0)}</Td>
                      <Td className="text-right tabular text-sub">{money(g.cost30)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Incident log" subtitle="Outages take every online game down at once.">
          {i.incidents.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-good">
              <ShieldCheck size={15} /> No incidents. Smooth sailing.
            </div>
          ) : (
            <ul className="space-y-2">
              {i.incidents.slice(0, 8).map((inc) => (
                <li key={`${inc.day}-${inc.cause}`} className="flex items-start gap-2 text-sm">
                  <CircleAlert size={14} className="mt-0.5 shrink-0 text-bad" />
                  <span className="flex-1">
                    {inc.days} day{inc.days > 1 ? 's' : ''} down: {inc.cause}
                  </span>
                  <span className="text-xs text-muted">{date(inc.day)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
