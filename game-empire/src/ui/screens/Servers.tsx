import { useState } from 'react';
import { Activity, ArrowUpCircle, Building2, Check, CircleAlert, Cloud, Gauge, Globe, HardHat, Lock, Minus, Plus, RefreshCw, Server, ShieldCheck, Star, Warehouse, Zap } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { DC_BUILDINGS, DC_MAX_UPGRADE, DC_UPGRADES, DC_UPGRADE_IDS, REGIONS, REGION_IDS, SERVER_MODELS, SERVER_MODEL_IDS, SERVER_TIERS, dcUpgradeCost } from '../../engine/constants';
import { buyNodes, fleetDown, infraCapacity, infraCostMult, infraEffects, infraMonthlyCost, infraUptime, isOnline, sellNodes, setAutoscale, setServerTier, tierBlocker } from '../../engine/infra';
import {
  MAX_DATA_CENTERS,
  buildingBlocker,
  buyDataCenter,
  buyServers,
  closeDataCenter,
  dcCapacity,
  dcMonthlyCost,
  dcOnline,
  dcPerformance,
  dcPowerCap,
  dcPowerDraw,
  dcReady,
  dcSlots,
  dcUpgradeBlocker,
  dcUsedSlots,
  expandBlocker,
  expandCost,
  expandDataCenter,
  fleetPerformance,
  onlineFleetCapacity,
  ownedCapacity,
  refreshCost,
  refreshHardware,
  regionCoverage,
  rentedCapacity,
  sellServers,
  serverBlocker,
  serversThatFit,
  upgradeDataCenter,
} from '../../engine/datacenters';
import type { DataCenter, RegionId } from '../../engine/types';
import { gamesOf, playerCompany } from '../../engine/util';
import { date, money, num, pct } from '../lib/format';
import { TimeChart } from '../components/charts';
import { Badge, Button, Card, ConfirmButton, Empty, Progress, SectionTitle, Stat, Tabs, Td, Th, cx } from '../components/ui';

type Tab = 'overview' | 'datacenters' | 'cloud';

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
  const [tab, setTab] = useState<Tab>('overview');
  const i = w.player.infra;
  const dcs = i.dataCenters;
  return (
    <div className="space-y-4">
      <SectionTitle
        actions={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs">
            <input type="checkbox" checked={i.autoscale} onChange={(e) => act((world) => setAutoscale(world, e.target.checked))} />
            <span>
              <span className="font-medium text-ink">Autoscale</span>
              <span className="ml-1 text-muted">fills your data centers first, then rents cloud nodes</span>
            </span>
          </label>
        }
      >
        Servers
      </SectionTitle>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'datacenters', label: `Data centers (${dcs.length})` },
          { id: 'cloud', label: `Cloud hosting (${i.nodes} node${i.nodes === 1 ? '' : 's'})` },
        ]}
      />
      {tab === 'overview' && <Overview onTab={setTab} />}
      {tab === 'datacenters' && <DataCenters />}
      {tab === 'cloud' && <CloudHosting />}
    </div>
  );
}

// ------------------------------------------------------------ overview

function Overview({ onTab }: { onTab: (t: Tab) => void }) {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const p = playerCompany(w);
  const i = w.player.infra;
  const fx = infraEffects(w);
  const online = gamesOf(w, p.id).filter((g) => g.status === 'released' && isOnline(g)).sort((a, b) => b.ccu - a.ccu);
  const planned = gamesOf(w, p.id).filter((g) => g.status === 'development' && isOnline(g));
  const monthly = infraMonthlyCost(w);
  const uptime = infraUptime(w);
  const down = fleetDown(w);
  const owned = ownedCapacity(w, false);
  const rented = rentedCapacity(w);
  const running = onlineFleetCapacity(w);
  const perf = fleetPerformance(w);
  const regions = regionCoverage(w);

  return (
    <div className="space-y-4">
      {online.length === 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          Your servers host every <strong className="text-ink">online</strong> and <strong className="text-ink">massively multiplayer</strong> game you release. Rent cloud nodes to start, then buy a warehouse and fill it with your own servers: more upfront, far cheaper to run, and smoother for players.
          {planned.length > 0 ? ` ${planned.length} online game${planned.length > 1 ? 's are' : ' is'} in development. Make sure capacity is ready for launch day.` : ''}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Capacity" value={num(infraCapacity(w))} sub={`${num(owned)} owned · ${num(rented)} rented`} icon={<Gauge size={13} />} />
        <Stat
          label="Load"
          value={pct(i.load)}
          tone={loadTone(i.load)}
          sub={down ? 'Everything is down' : running < infraCapacity(w) ? `${num(infraCapacity(w) - running)} capacity offline` : i.load > 1 ? 'Overloaded: players turned away' : `${num(i.demand)} players online`}
          icon={<Activity size={13} />}
        />
        <Stat label="Performance" value={pct(perf)} tone={perf >= 0.6 ? 'good' : perf >= 0.3 ? undefined : 'warn'} sub={`${regions} region${regions > 1 ? 's' : ''} covered · ${fx.score >= 0 ? '+' : ''}${fx.score.toFixed(1)} user score`} icon={<Globe size={13} />} />
        <Stat label="Uptime (90 days)" value={pct(uptime, 1)} tone={uptime >= 0.99 ? 'good' : uptime >= 0.96 ? 'warn' : 'bad'} sub="Partial outages count a quarter" icon={<ShieldCheck size={13} />} />
        <Stat label="Monthly cost" value={money(monthly)} sub={infraCostMult(w) < 1 ? `${pct(1 - infraCostMult(w))} discount from research, perks & engine` : 'Rent, hardware, power, bandwidth'} icon={<Zap size={13} />} />
      </div>

      <Card title="Players online vs capacity" subtitle={fx.overloaded ? 'Over capacity: fewer new players, more churn, worse reviews.' : 'Stay under the line and your games run smoothly.'}>
        <LoadGauge load={i.load} className="mb-3" />
        <TimeChart
          series={[
            { key: 'cap', name: 'Capacity running', color: '#5b6878', data: i.capacityHistory },
            { key: 'dem', name: 'Players online', color: '#3987e5', data: i.demandHistory },
          ]}
          format={(n) => num(n)}
          height={220}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <button onClick={() => onTab('datacenters')} className="card-hover flex items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Warehouse size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Your data centers</div>
            <div className="text-xs text-muted">
              {w.player.infra.dataCenters.length ? `${w.player.infra.dataCenters.length} building${w.player.infra.dataCenters.length > 1 ? 's' : ''} · room for ${num(owned)} players` : 'Buy a server closet or warehouse and fill it with your own servers.'}
            </div>
          </div>
        </button>
        <button onClick={() => onTab('cloud')} className="card-hover flex items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-sub">
            <Cloud size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Cloud hosting · {SERVER_TIERS[i.tier].name}</div>
            <div className="text-xs text-muted">
              {i.nodes} node{i.nodes === 1 ? '' : 's'} rented · room for {num(rented)} players
            </div>
          </div>
        </button>
      </div>

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
        <Card title="Incident log" subtitle="Cloud outages and building failures.">
          {i.incidents.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-good">
              <ShieldCheck size={15} /> No incidents. Smooth sailing.
            </div>
          ) : (
            <ul className="space-y-2">
              {i.incidents.slice(0, 8).map((inc) => (
                <li key={`${inc.day}-${inc.cause}-${inc.where ?? ''}`} className="flex items-start gap-2 text-sm">
                  <CircleAlert size={14} className={cx('mt-0.5 shrink-0', inc.full === false ? 'text-warn' : 'text-bad')} />
                  <span className="flex-1">
                    {inc.where && inc.where !== 'cloud' ? `${inc.where}: ` : inc.where === 'cloud' ? 'Cloud: ' : ''}
                    {inc.days} day{inc.days > 1 ? 's' : ''} down, {inc.cause}
                    {inc.full === false && <span className="text-muted"> (partial)</span>}
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

// ------------------------------------------------------------ data centers

function DataCenters() {
  const w = useWorld();
  const dcs = w.player.infra.dataCenters;
  return (
    <div className="space-y-4">
      {dcs.length === 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          Own your hardware. Buy a building, wait for construction, then fill its racks with servers. Upgrade floor space and power to fit more, cooling and backup generators to fail less, and the network uplink so games feel smoother. Owning costs more up front than renting, but much less every month.
        </div>
      )}
      {dcs.map((dc) => (
        <DataCenterCard key={dc.id} dc={dc} />
      ))}
      {dcs.length < MAX_DATA_CENTERS && <BuyDataCenter />}
    </div>
  );
}

/** Power in kW, MW or GW. */
function watts(kw: number): string {
  if (kw >= 1e6) return `${(kw / 1e6).toFixed(2)} GW`;
  if (kw >= 1000) return `${(kw / 1000).toFixed(1).replace(/\.0$/, '')} MW`;
  return `${kw.toFixed(1).replace(/\.0$/, '')} kW`;
}

function Meter({ label, value, max, unit, tone }: { label: string; value: number; max: number; unit?: string; tone?: 'good' | 'warn' | 'bad' | 'accent' }) {
  const frac = max > 0 ? value / max : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="tabular text-sub">
          {unit === 'kW' ? `${watts(value)} / ${watts(max)}` : `${num(value)} / ${num(max)} ${unit ?? ''}`}
        </span>
      </div>
      <Progress value={value} max={max} tone={tone ?? (frac > 0.9 ? 'warn' : 'accent')} />
    </div>
  );
}

function DataCenterCard({ dc }: { dc: DataCenter }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const ready = dcReady(w, dc);
  const online = dcOnline(w, dc);
  const building = DC_BUILDINGS[dc.building];
  const next = DC_BUILDINGS[dc.building + 1];
  const expBlock = expandBlocker(w, dc);
  const status = !ready ? (
    <Badge tone="warn">
      <HardHat size={11} /> Building · {dc.readyDay - w.day}d
    </Badge>
  ) : !online ? (
    <Badge tone="bad">Offline · {dc.offlineUntil - w.day}d</Badge>
  ) : (
    <Badge tone="good">Online</Badge>
  );
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Building2 size={15} className="text-accent" />
          {dc.name}
          {status}
          {dc.expandTo !== null && (
            <Badge tone="accent">
              <HardHat size={11} /> Becoming a {DC_BUILDINGS[dc.expandTo].name} · {dc.expandDay - w.day}d
            </Badge>
          )}
        </span>
      }
      subtitle={`${REGIONS[dc.region].name} · ${building.name} · rent ${money(building.rent)}/mo · running cost ${money(dcMonthlyCost(w, dc))}/mo`}
      actions={
        <ConfirmButton variant="ghost" confirmLabel="Sell it?" onConfirm={() => act((world) => closeDataCenter(world, dc.id))}>
          Sell
        </ConfirmButton>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Hosts" value={num(dcCapacity(dc))} sub="players" className="px-3 py-2" />
            <Stat label="Performance" value={pct(dcPerformance(dc))} className="px-3 py-2" />
          </div>
          <Meter label="Rack space" value={dcUsedSlots(dc)} max={dcSlots(dc)} unit="slots" />
          <Meter label="Power" value={dcPowerDraw(dc)} max={dcPowerCap(dc)} unit="kW" />
          <Meter label="Hardware wear" value={dc.wear * 100} max={100} unit="%" tone={dc.wear > 0.75 ? 'bad' : dc.wear > 0.5 ? 'warn' : 'good'} />
          <div className="flex flex-wrap gap-2">
            {next && (
              <Button size="sm" variant={expBlock ? 'secondary' : 'primary'} disabled={!!expBlock} title={expBlock ?? undefined} onClick={() => act((world) => expandDataCenter(world, dc.id))}>
                <ArrowUpCircle size={13} /> {expBlock && !expBlock.startsWith('Costs') ? expBlock : `Grow into ${next.name} · ${money(expandCost(dc))}`}
              </Button>
            )}
            <Button size="sm" disabled={dc.wear < 0.05 || w.player.infra.dataCenters.length === 0} onClick={() => act((world) => refreshHardware(world, dc.id))} title="Replace worn parts: performance and reliability back to new">
              <RefreshCw size={13} /> Refresh hardware{dc.wear >= 0.05 ? ` · ${money(refreshCost(dc))}` : ''}
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-sub">Servers</div>
          <div className="space-y-1.5">
            {SERVER_MODEL_IDS.map((m) => {
              const def = SERVER_MODELS[m];
              const n = dc.servers[m];
              const block = serverBlocker(w, dc, m, 1);
              const locked = block && (block.startsWith('Needs') || block.startsWith('Still'));
              const fit = serversThatFit(dc, m);
              return (
                <div key={m} className={cx('rounded-lg border px-2.5 py-2', n > 0 ? 'border-accent/40 bg-accent-soft/20' : 'border-line bg-surface-2')}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        {locked && <Lock size={11} className="text-muted" />}
                        {def.name}
                        {n > 0 && <span className="text-accent">×{n}</span>}
                      </div>
                      <div className="text-[10px] text-muted">
                        {num(def.capacity)} players · {def.slots} slot{def.slots > 1 ? 's' : ''} · {watts(def.power)} · {money(def.cost)}
                      </div>
                    </div>
                    <button onClick={() => act((world) => sellServers(world, dc.id, m, 1))} disabled={n === 0} className="flex h-6 w-6 items-center justify-center rounded border border-line text-sub disabled:opacity-30" aria-label={`Sell one ${def.name}`}>
                      <Minus size={12} />
                    </button>
                    <button onClick={() => act((world) => buyServers(world, dc.id, m, 1))} disabled={!!block} title={block ?? `Add one (${money(def.cost)})`} className="flex h-6 w-6 items-center justify-center rounded border border-accent/50 bg-accent text-white disabled:border-line disabled:bg-transparent disabled:text-muted disabled:opacity-40" aria-label={`Add one ${def.name}`}>
                      <Plus size={12} />
                    </button>
                    <button
                      onClick={() => act((world) => buyServers(world, dc.id, m, Math.min(fit, Math.max(1, Math.floor(playerCompany(world).cash / def.cost)))))}
                      disabled={!!block || fit <= 1}
                      title={fit > 1 ? `Fill the free space with up to ${fit}` : undefined}
                      className="h-6 rounded border border-line px-1.5 text-[10px] font-semibold text-sub disabled:opacity-30"
                    >
                      Fill
                    </button>
                  </div>
                  {locked && <div className="mt-0.5 text-[10px] text-warn">{block}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-sub">Upgrades</div>
          <div className="space-y-1.5">
            {DC_UPGRADE_IDS.map((u) => {
              const lvl = dc.upgrades[u];
              const block = dcUpgradeBlocker(w, dc, u);
              return (
                <div key={u} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      {DC_UPGRADES[u].name}
                      <span className="flex gap-0.5">
                        {Array.from({ length: DC_MAX_UPGRADE }, (_, k) => (
                          <Star key={k} size={9} className={k < lvl ? 'fill-accent text-accent' : 'text-line'} />
                        ))}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted">{DC_UPGRADES[u].blurb}</div>
                  </div>
                  {lvl >= DC_MAX_UPGRADE ? (
                    <Check size={14} className="text-good" />
                  ) : (
                    <Button size="sm" variant={block ? 'secondary' : 'primary'} disabled={!!block} title={block ?? undefined} onClick={() => act((world) => upgradeDataCenter(world, dc.id, u))}>
                      {money(dcUpgradeCost(dc.building, lvl))}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function BuyDataCenter() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const [region, setRegion] = useState<RegionId>(() => (['na', 'eu', 'asia', 'sa', 'oce'] as RegionId[]).find((r) => !w.player.infra.dataCenters.some((d) => d.region === r)) ?? 'na');
  const p = playerCompany(w);
  return (
    <Card title="Buy a new data center" subtitle="Each region you cover gives players lower ping: a little more growth and better reviews.">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {REGION_IDS.map((r) => {
          const have = w.player.infra.dataCenters.filter((d) => d.region === r).length;
          return (
            <button key={r} onClick={() => setRegion(r)} className={cx('rounded-full border px-3 py-1 text-xs font-medium transition-colors', region === r ? 'border-accent bg-accent-soft text-accent' : 'border-line text-sub hover:text-ink')}>
              {REGIONS[r].name}
              {have > 0 && <span className="ml-1 text-muted">({have})</span>}
            </button>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {DC_BUILDINGS.map((b, idx) => {
          const block = buildingBlocker(w, idx);
          const locked = block && block.startsWith('Needs');
          return (
            <div key={b.name} className="flex flex-col rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Warehouse size={14} className={locked ? 'text-muted' : 'text-accent'} />
                  {b.name}
                </span>
                {locked && <Lock size={12} className="text-muted" />}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                <span className="text-muted">Rack slots</span>
                <span className="text-right tabular">{num(b.slots)}</span>
                <span className="text-muted">Power</span>
                <span className="text-right tabular">{watts(b.power)}</span>
                <span className="text-muted">Rent</span>
                <span className="text-right tabular">{money(b.rent)}/mo</span>
                <span className="text-muted">Build time</span>
                <span className="text-right tabular">{b.build} days</span>
              </div>
              {locked && <div className="mt-2 text-[11px] text-warn">{block}</div>}
              <Button size="sm" className="mt-2 w-full" variant={block ? 'secondary' : 'primary'} disabled={!!block || p.cash < b.cost} onClick={() => act((world) => buyDataCenter(world, idx, region))}>
                Buy in {REGIONS[region].name} · {money(b.cost)}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ cloud

function CloudHosting() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const p = playerCompany(w);
  const i = w.player.infra;
  const tier = SERVER_TIERS[i.tier];
  const nodeCost = tier.nodeCost;
  const canDropAll = ownedCapacity(w, false) > 0;
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1" title="Rented nodes" subtitle={`${tier.name}: ${money(nodeCost)} per node, ${money(tier.nodeMaintenance)}/mo upkeep`}>
          <div className="flex items-center justify-between gap-2">
            <Button onClick={() => act((world) => sellNodes(world, 1))} disabled={i.nodes <= (canDropAll ? 0 : 1)} title="Release one node (30% refund)">
              <Minus size={14} />
            </Button>
            <div className="text-center">
              <div className="text-3xl font-semibold tabular">{i.nodes}</div>
              <div className="text-xs text-muted">of {tier.maxNodes} max · {num(rentedCapacity(w))} players</div>
            </div>
            <Button variant="primary" onClick={() => act((world) => buyNodes(world, 1))} disabled={i.nodes >= tier.maxNodes || p.cash < nodeCost} title={`Rent one node (${money(nodeCost)})`}>
              <Plus size={14} />
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => act((world) => buyNodes(world, 5))} disabled={i.nodes >= tier.maxNodes || p.cash < nodeCost * Math.min(5, tier.maxNodes - i.nodes)}>
              +5 nodes
            </Button>
            <Button size="sm" onClick={() => act((world) => sellNodes(world, 5))} disabled={i.nodes <= (canDropAll ? 0 : 1)}>
              −5 nodes
            </Button>
            <Button size="sm" onClick={() => act((world) => buyNodes(world, 50))} disabled={i.nodes >= tier.maxNodes || p.cash < nodeCost * Math.min(50, tier.maxNodes - i.nodes)}>
              +50 nodes
            </Button>
            <Button
              size="sm"
              onClick={() => act((world) => buyNodes(world, Math.max(1, Math.min(tier.maxNodes - world.player.infra.nodes, Math.floor(playerCompany(world).cash / nodeCost)))))}
              disabled={i.nodes >= tier.maxNodes || p.cash < nodeCost}
              title="Rent as many nodes as you can afford, up to the tier's limit"
            >
              Max
            </Button>
          </div>
          <div className="mt-3 text-xs text-muted">{canDropAll ? 'You own servers, so you can drop rented hosting completely.' : 'Keep at least one node until you own servers.'}</div>
        </Card>
        <Card className="xl:col-span-2" title="Why rent?" subtitle="Rented hosting scales instantly with no building to wait for.">
          <ul className="space-y-1.5 text-sm text-sub">
            <li>• No construction time: nodes are live the moment you buy them.</li>
            <li>• Great for launches and spikes, while your own buildings are still being built or filled.</li>
            <li>• Costs more every month than running your own servers. Move steady load into your data centers.</li>
            <li>• If the cloud fails while you also own servers, only the cloud share of your players is affected.</li>
          </ul>
        </Card>
      </div>
      <Card
        title="Cloud tiers"
        subtitle={`Tier ${i.tier + 1} of ${SERVER_TIERS.length}. Better tiers carry more players per node, fail less, and make games feel smoother. Your rented capacity carries over when you move. The biggest tiers unlock as your empire grows.`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${SERVER_TIERS.length} tiers`}
          </Button>
        }
      >
        <div className="mb-3 flex gap-0.5" aria-label={`Tier ${i.tier + 1} of ${SERVER_TIERS.length}`}>
          {SERVER_TIERS.map((t, k) => (
            <span key={t.name} title={t.name} className={cx('h-1.5 flex-1 rounded-full', k < i.tier ? 'bg-good' : k === i.tier ? 'bg-accent' : 'bg-surface-3')} />
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {SERVER_TIERS.map((t, idx) => {
            if (!showAll && (idx < i.tier - 1 || idx > i.tier + 5)) return null;
            const current = idx === i.tier;
            const blocker = tierBlocker(w, idx);
            const lockedReason = blocker && !blocker.startsWith('Costs') ? blocker : null;
            return (
              <div key={t.name} className={cx('rounded-lg border p-3', current ? 'border-accent bg-accent-soft/30' : idx < i.tier ? 'border-line-soft bg-surface-2/60' : 'border-line bg-surface-2')}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Cloud size={14} className={current ? 'text-accent' : 'text-muted'} />
                    {t.name}
                    <span className="text-[10px] font-normal text-muted">#{idx + 1}</span>
                  </div>
                  {current ? <Badge tone="accent">Current</Badge> : idx < i.tier ? <Check size={14} className="text-good" /> : lockedReason ? <Lock size={13} className="text-muted" /> : null}
                </div>
                <p className="mt-1 text-xs text-sub">{t.blurb}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  <span className="text-muted">Per node</span>
                  <span className="text-right tabular">{num(t.nodeCapacity)} players</span>
                  <span className="text-muted">Max capacity</span>
                  <span className="text-right tabular">{num(t.nodeCapacity * t.maxNodes)}</span>
                  <span className="text-muted">Node price</span>
                  <span className="text-right tabular">{money(t.nodeCost)}</span>
                  <span className="text-muted">Node upkeep</span>
                  <span className="text-right tabular">{money(t.nodeMaintenance)}/mo</span>
                  <span className="text-muted">Outage risk</span>
                  <span className="text-right tabular">{monthlyOutageRisk(t.outage) < 0.001 ? '<0.1%' : pct(monthlyOutageRisk(t.outage), monthlyOutageRisk(t.outage) < 0.01 ? 1 : 0)}/mo</span>
                </div>
                {lockedReason && <div className="mt-2 text-[11px] text-warn">{lockedReason}</div>}
                {!current && (
                  <Button size="sm" className="mt-2 w-full" variant={idx > i.tier ? 'primary' : 'secondary'} disabled={!!blocker} onClick={() => act((world) => setServerTier(world, idx))}>
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
        {!showAll && i.tier + 5 < SERVER_TIERS.length - 1 && (
          <button onClick={() => setShowAll(true)} className="mt-2 w-full rounded-lg border border-dashed border-line py-2 text-xs text-sub hover:text-ink">
            {SERVER_TIERS.length - i.tier - 6} bigger tiers above, all the way to the {SERVER_TIERS[SERVER_TIERS.length - 1].name} ({num(SERVER_TIERS[SERVER_TIERS.length - 1].nodeCapacity * SERVER_TIERS[SERVER_TIERS.length - 1].maxNodes)} players)
          </button>
        )}
      </Card>
    </div>
  );
}
