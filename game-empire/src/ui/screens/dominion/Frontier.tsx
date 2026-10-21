// The frontier: Virtual Gaming Universes, the Space Economy and Company Cities.
import { useState } from 'react';
import { Building, Earth, Plus, Rocket } from 'lucide-react';
import { useGameStore, useWorld } from '../../../store/gameStore';
import { fmtPeople } from '../../../engine/dominionCore';
import { REGIONS, REGION_IDS, TOPICS, TOPIC_IDS } from '../../../engine/constants';
import { UNIVERSE_SCALES, closeUniverse, contentDrop, contentDropCost, createUniverse, landPrice, sellLand, setUniverse, universeCapacity, worldMood, worldServerCoverage } from '../../../engine/universes';
import { SPACE, SPACE_KINDS, assetCost, buildSpace, launchRisk, launchTechCost, offworldShare, playerColonists, shieldCost, spaceBlocker, upgradeLaunchTech, upgradeShield, upgradeSpace } from '../../../engine/space';
import { DISTRICTS, DISTRICT_KINDS, DISTRICT_MAX, buildDistrict, cityCost, demolishDistrict, districtCost, expandCity, expandCost, foundCity, setCity, upgradeDistrict } from '../../../engine/cities';
import { activeCorps, partyName } from '../../../engine/megacorps';
import { playerCompany } from '../../../engine/util';
import type { CompanyCity, DistrictKind, RegionId, TopicId, Universe } from '../../../engine/types';
import { date, money, num, pct } from '../../lib/format';
import { Badge, Button, Card, ConfirmButton, Empty, Field, Progress, cx, inputClass } from '../../components/ui';
import { TimeChart } from '../../components/charts';
import { DecisionCard } from '../../components/Overlays';
import { FeatureGate, Meter, Mini, Pips, useAct } from './shared';

function Pending({ kinds }: { kinds: string[] }) {
  const w = useWorld();
  const pending = w.pendingEvents.filter((e) => kinds.includes(e.kind));
  if (!pending.length) return null;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {pending.map((ev) => (
        <DecisionCard key={ev.id} ev={ev} />
      ))}
    </div>
  );
}

function Choice({ options, value, onChange }: { options: { id: number; label: string }[]; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={cx('rounded-md border px-2 py-1 text-[11px]', value === o.id ? 'border-accent bg-accent-soft/40 text-ink' : 'border-line bg-surface-2 text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ universes

export function UniversesTab() {
  const w = useWorld();
  const d = w.player.dominion;
  const worlds = d.universes.filter((u) => u.stage !== 'closed');
  const live = worlds.filter((u) => u.stage === 'live');
  const rivals = activeCorps(w).filter((c) => c.assets.universePop > 0);
  return (
    <FeatureGate f="universes">
      <div className="space-y-4">
        <Pending kinds={['worldRegulator', 'worldDupe']} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Live worlds" value={live.length} />
          <Mini label="Residents" value={fmtPeople(live.reduce((s, u) => s + u.population, 0))} />
          <Mini label="Income" value={`${money(live.reduce((s, u) => s + u.monthRevenue, 0))}/mo`} tone="good" />
          <Mini label="Rival worlds" value={rivals.length ? fmtPeople(rivals.reduce((s, c) => s + c.assets.universePop, 0)) : '—'} />
        </div>
        {worlds.map((u) => (
          <UniverseCard key={u.id} u={u} />
        ))}
        <NewUniverse first={!worlds.length} />
      </div>
    </FeatureGate>
  );
}

function NewUniverse({ first }: { first: boolean }) {
  const w = useWorld();
  const act = useAct();
  const ips = Object.values(w.ips)
    .filter((ip) => ip.companyId === w.player.companyId)
    .sort((a, b) => b.fans - a.fans);
  const [name, setName] = useState(ips[0] ? `${ips[0].name} Online` : 'Aether');
  const [theme, setTheme] = useState<TopicId>(TOPIC_IDS[0]);
  const [ipId, setIpId] = useState<string>(ips[0]?.id ?? '');
  const [scale, setScale] = useState(1);
  const def = UNIVERSE_SCALES[scale - 1];
  return (
    <Card title={first ? 'Create your first virtual universe' : 'Create another universe'} subtitle="A persistent world with its own residents and economy. Built on a franchise, it starts with that franchise's fans.">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Name">
          <input className={inputClass} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Theme">
          <select className={inputClass} value={theme} onChange={(e) => setTheme(e.target.value as TopicId)}>
            {TOPIC_IDS.map((t) => (
              <option key={t} value={t}>
                {TOPICS[t].emoji} {TOPICS[t].name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Franchise">
          <select className={inputClass} value={ipId} onChange={(e) => setIpId(e.target.value)}>
            <option value="">Original world</option>
            {ips.map((ip) => (
              <option key={ip.id} value={ip.id}>
                {ip.name} ({num(ip.fans)} fans)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scale" hint={`${fmtPeople(def.capacity)} residents`}>
          <select className={inputClass} value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            {UNIVERSE_SCALES.map((s, i) => (
              <option key={s.name} value={i + 1}>
                {s.name} · {money(s.cost)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {money(def.cost)}, paid while it builds over about {def.days} days. Needs server capacity once it’s live.
        </span>
        <Button variant="primary" disabled={playerCompany(w).cash < def.cost * 0.25} onClick={() => act((world) => createUniverse(world, { name, theme, ipId: ipId || null, scale }), `Work begins on ${name}`)}>
          <Earth size={14} /> Create · {money(def.cost)}
        </Button>
      </div>
    </Card>
  );
}

function UniverseCard({ u }: { u: Universe }) {
  const w = useWorld();
  const act = useAct();
  const cap = universeCapacity(w, u);
  const cash = playerCompany(w).cash;
  if (u.stage === 'building') {
    const done = (w.day - u.founded) / Math.max(1, u.ready - u.founded);
    return (
      <Card title={u.name} subtitle={`${UNIVERSE_SCALES[u.scale - 1].name} · ${TOPICS[u.theme]?.name ?? u.theme} · opens ${date(u.ready)}`}>
        <Progress value={done} />
        <p className="mt-2 text-xs text-muted">
          Under construction: {Math.max(0, u.ready - w.day)} days to go. {fmtPeople(cap)} residents can live here.
        </p>
      </Card>
    );
  }
  const crisis = u.crisis && w.day < u.crisisUntil;
  const land = landPrice(u);
  const servers = worldServerCoverage(w);
  const mood = worldMood(w, u, servers);
  const series = u.history.length > 2;
  return (
    <Card
      className={crisis ? 'border-bad/50' : undefined}
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          <Earth size={14} className="text-accent" /> {u.name}
          <Badge tone="neutral">{UNIVERSE_SCALES[u.scale - 1].name}</Badge>
          {u.ipId && w.ips[u.ipId] && <Badge tone="accent">{w.ips[u.ipId].name}</Badge>}
          {crisis && <Badge tone="bad">{u.crisis}</Badge>}
        </span>
      }
      subtitle={`Opened ${date(u.ready)} · ${money(u.monthRevenue)}/mo · ${money(u.revenue)} all-time`}
      actions={
        <ConfirmButton onConfirm={() => act((world) => closeUniverse(world, u.id), `${u.name} is closed`)} confirmLabel="Shut it down?">
          Close
        </ConfirmButton>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-2.5">
          <Meter label="Residents" value={u.population} max={cap} right={`${fmtPeople(u.population)} / ${fmtPeople(cap)}`} />
          <Meter label="Satisfaction" value={u.satisfaction} tone={u.satisfaction < 40 ? 'bad' : u.satisfaction < 60 ? 'warn' : 'good'} right={`${Math.round(u.satisfaction)} → ${Math.round(mood.target)}`} />
          <div className="flex flex-wrap gap-1 text-[11px]">
            {mood.parts
              .slice()
              .sort((a, b) => a.value - b.value)
              .map((x) => (
                <span key={x.label} className={cx('rounded px-1.5 py-0.5', x.value < 0 ? 'bg-bad-soft text-bad' : 'bg-good-soft text-good')}>
                  {x.label} {x.value > 0 ? '+' : ''}
                  {Math.round(x.value)}
                </span>
              ))}
          </div>
          {servers < 0.95 && <ServerWarning coverage={servers} />}
          <Meter label="Toxicity" value={u.toxicity} tone={u.toxicity > 60 ? 'bad' : u.toxicity > 40 ? 'warn' : 'good'} />
          <Meter label="Content freshness" value={u.freshness * 100} tone={u.freshness < 0.4 ? 'warn' : 'accent'} right={pct(u.freshness)} />
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Price index" value={Math.round(u.prices)} tone={u.prices > 180 ? 'bad' : undefined} />
            <Mini label="Inflation" value={pct(u.inflation, 1)} tone={u.inflation > 0.15 ? 'bad' : u.inflation < -0.05 ? 'warn' : undefined} />
            <Mini label="Land sold" value={pct(u.landSold)} />
          </div>
          {series && (
            <TimeChart
              height={120}
              format={fmtPeople}
              series={[{ key: 'pop', name: 'Residents', color: '#3987e5', data: u.history.map((h) => [h[0], h[1]] as [number, number]) }]}
            />
          )}
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={u.autopilot} onChange={(e) => act((world) => setUniverse(world, u.id, { autopilot: e.target.checked }))} /> Central bank autopilot
            <span className="text-xs text-muted">(steers coin drops to keep inflation near 3%)</span>
          </label>
          <Field label="Trade tax" hint={pct(u.tax)}>
            <input type="range" min={0} max={0.3} step={0.01} value={u.tax} disabled={u.autopilot} onChange={(e) => act((world) => setUniverse(world, u.id, { tax: Number(e.target.value) }))} className="w-full disabled:opacity-40" />
          </Field>
          <Field label="Coin drops (faucet)" hint={u.faucet < 0.3 ? 'tight' : u.faucet > 1 ? 'generous' : 'normal'}>
            <input type="range" min={0} max={2} step={0.05} value={u.faucet} disabled={u.autopilot} onChange={(e) => act((world) => setUniverse(world, u.id, { faucet: Number(e.target.value) }))} className="w-full disabled:opacity-40" />
          </Field>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">Moderation</span>
            <Choice options={['None', 'Light', 'Strict', 'Total'].map((label, id) => ({ id, label }))} value={u.moderation} onChange={(v) => act((world) => setUniverse(world, u.id, { moderation: v }))} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={u.rmt} onChange={(e) => act((world) => setUniverse(world, u.id, { rmt: e.target.checked }))} /> Real-money trading
            <span className="text-xs text-muted">(big income, regulators and scams)</span>
          </label>
          <div className="flex flex-wrap gap-1.5 border-t border-line-soft pt-3">
            <Button size="sm" variant="primary" disabled={cash < contentDropCost(u)} onClick={() => act((world) => contentDrop(world, u.id), 'Fresh content is live')}>
              Content drop · {money(contentDropCost(u))}
            </Button>
            <Button size="sm" disabled={u.landSold + 0.01 > 0.9 || land <= 0} onClick={() => act((world) => sellLand(world, u.id, 0.01))}>
              Sell 1% land · {money(land)}
            </Button>
            <Button size="sm" disabled={u.landSold + 0.05 > 0.9 || land <= 0} onClick={() => act((world) => sellLand(world, u.id, 0.05))}>
              Sell 5% · {money(land * 5)}
            </Button>
          </div>
          <p className="text-[11px] text-muted">Selling land is quick money, but past 60% residents feel squeezed. Bubbles can burst.</p>
        </div>
      </div>
    </Card>
  );
}

function ServerWarning({ coverage }: { coverage: number }) {
  const navigate = useGameStore((s) => s.navigate);
  return (
    <button onClick={() => navigate({ name: 'servers' })} className="w-full rounded-lg border border-warn/40 bg-warn-soft/40 px-3 py-2 text-left text-xs text-warn">
      Residents are lagging: your spare server capacity covers {pct(coverage)} of your worlds. Add servers or data districts in your cities. →
    </button>
  );
}

// ------------------------------------------------------------ space

export function SpaceTab() {
  const w = useWorld();
  const act = useAct();
  const s = w.player.dominion.space;
  const cash = playerCompany(w).cash;
  const mine = s.assets.filter((a) => a.stage !== 'lost');
  const rivals = activeCorps(w)
    .filter((c) => c.assets.spaceAssets > 0)
    .sort((a, b) => b.assets.spaceAssets - a.assets.spaceAssets);
  const ore = (w.player.flags.oreIndex ?? 1000) / 1000;
  return (
    <FeatureGate f="space">
      <div className="space-y-4">
        <Pending kinds={['spaceFail']} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Your colonists" value={fmtPeople(playerColonists(w))} />
          <Mini label="Off-world market share" value={pct(offworldShare(w))} />
          <Mini label="Space income" value={`${money(s.monthRevenue)}/mo`} tone="good" />
          <Mini label="Ore prices" value={`×${ore.toFixed(2)}`} tone={ore < 0.7 ? 'bad' : ore > 1.3 ? 'good' : undefined} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card title="Rockets" subtitle={`Launch failure risk ${pct(launchRisk(w), 1)} per build. Better rockets cut costs 8% a generation.`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Reusable rockets</div>
                <Pips level={s.launchTech} max={5} />
              </div>
              <Button size="sm" variant="primary" disabled={s.launchTech >= 5 || cash < launchTechCost(s.launchTech)} onClick={() => act((world) => upgradeLaunchTech(world), 'New rocket generation')}>
                {s.launchTech >= 5 ? 'Maxed' : `Gen ${s.launchTech + 1} · ${money(launchTechCost(s.launchTech))}`}
              </Button>
            </div>
          </Card>
          <Card title="Shielding" subtitle="Protects stations from solar storms, debris and radiation. Hazards knock assets offline.">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Radiation and debris shields</div>
                <Pips level={s.shield} max={5} />
              </div>
              <Button size="sm" disabled={s.shield >= 5 || cash < shieldCost(s.shield)} onClick={() => act((world) => upgradeShield(world), 'Shields upgraded')}>
                {s.shield >= 5 ? 'Maxed' : `Level ${s.shield + 1} · ${money(shieldCost(s.shield))}`}
              </Button>
            </div>
          </Card>
        </div>

        {mine.length > 0 && (
          <Card title="Your space program" subtitle={`${s.incidents} incidents so far · upkeep 4% a year of what each asset cost`}>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {mine.map((a) => {
                const def = SPACE[a.kind];
                const building = a.stage === 'building';
                const offline = w.day < a.offlineUntil;
                const up = assetCost(w, a.kind, a.level + 1);
                return (
                  <div key={a.id} className={cx('rounded-lg border bg-surface-2 p-3', offline ? 'border-bad/50' : 'border-line')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          {def.emoji} {a.name}
                        </div>
                        <div className="text-[11px] text-muted">{building ? `Ready ${date(a.ready)}` : offline ? `Offline until ${date(a.offlineUntil)}` : `${money(a.output)}/mo last month`}</div>
                      </div>
                      {!building && <Pips level={a.level} max={5} />}
                    </div>
                    {building ? (
                      <Progress value={(w.day - a.start) / Math.max(1, a.ready - a.start)} className="mt-2" />
                    ) : (
                      a.level < 5 && (
                        <Button size="sm" className="mt-2" disabled={cash < up} onClick={() => act((world) => upgradeSpace(world, a.id), `${a.name} expanded`)}>
                          Expand · {money(up)}
                        </Button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <Card title="Build" subtitle="Each project is paid day by day while it builds; launches can fail. Firsts in history win fans.">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {SPACE_KINDS.map((k) => {
              const def = SPACE[k];
              const blocker = spaceBlocker(w, k);
              const first = s.firsts[k];
              return (
                <div key={k} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold">
                      {def.emoji} {def.name}
                    </div>
                    {first && <Badge tone={first === 'player' ? 'good' : 'neutral'}>First: {first === 'player' ? 'you' : partyName(w, first)}</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{def.blurb}</p>
                  <div className="mt-1.5 text-[11px] tabular text-sub">
                    {money(assetCost(w, k))} · {def.days} days · ~{money(def.output)}/yr{def.colonists ? ` · ${fmtPeople(def.colonists)} colonists` : ''}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-warn">{blocker ?? ''}</span>
                    <Button size="sm" variant="primary" disabled={!!blocker} onClick={() => act((world) => buildSpace(world, k), `Construction begins: ${def.name}`)}>
                      <Rocket size={12} /> Build
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="The space race" subtitle="Megacorps build too. Everyone off Earth is a market for games.">
          <div className="text-xs text-muted">People living off Earth: {fmtPeople(s.offworld)}</div>
          {rivals.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {rivals.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span style={{ color: c.color }}>{c.name}</span>
                  <span className="text-xs text-sub">{c.assets.spaceAssets} assets</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-sub">No rival has left the ground yet.</p>
          )}
        </Card>
      </div>
    </FeatureGate>
  );
}

// ------------------------------------------------------------ cities

export function CitiesTab() {
  const w = useWorld();
  const d = w.player.dominion;
  return (
    <FeatureGate f="cities">
      <div className="space-y-4">
        <Pending kinds={['cityRiot']} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Cities" value={d.cities.length} />
          <Mini label="Residents" value={fmtPeople(d.cities.reduce((s, c) => s + c.population, 0))} />
          <Mini label="City income" value={`${money(d.cities.reduce((s, c) => s + c.monthRevenue, 0))}/mo`} tone="good" />
          <Mini label="Rival cities" value={activeCorps(w).reduce((s, c) => s + c.assets.cities, 0)} />
        </div>
        {d.cities.map((c) => (
          <CityCard key={c.id} c={c} />
        ))}
        <NewCity first={!d.cities.length} />
      </div>
    </FeatureGate>
  );
}

function NewCity({ first }: { first: boolean }) {
  const w = useWorld();
  const act = useAct();
  const [region, setRegion] = useState<RegionId>('na');
  const [name, setName] = useState(`${playerCompany(w).name.split(' ')[0]} City`);
  const cost = cityCost(w);
  return (
    <Card title={first ? 'Found a company city' : 'Found another city'} subtitle="A whole city: homes for your people, campuses, research parks, server farms and factories. It takes 18 months to build the core.">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56 max-w-full">
          <Field label="Name">
            <input className={inputClass} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Region">
            <select className={inputClass} value={region} onChange={(e) => setRegion(e.target.value as RegionId)}>
              {REGION_IDS.map((r) => (
                <option key={r} value={r}>
                  {REGIONS[r].name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button variant="primary" disabled={playerCompany(w).cash < cost} onClick={() => act((world) => foundCity(world, name, region), `Groundbreaking for ${name}`)}>
          <Building size={14} /> Found · {money(cost)}
        </Button>
      </div>
    </Card>
  );
}

function CityCard({ c }: { c: CompanyCity }) {
  const w = useWorld();
  const act = useAct();
  const [kind, setKind] = useState<DistrictKind>('residential');
  const cash = playerCompany(w).cash;
  const building = w.day < c.ready;
  const trouble = w.day < c.troubleUntil;
  const free = c.slots - c.districts.length;
  const series = c.history.length > 2;
  return (
    <Card
      className={trouble ? 'border-bad/50' : undefined}
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          <Building size={14} className="text-accent" /> {c.name}
          <span className="font-normal text-muted">{REGIONS[c.region].name}</span>
          {trouble && <Badge tone="bad">Trouble until {date(c.troubleUntil)}</Badge>}
        </span>
      }
      subtitle={building ? `Core ready ${date(c.ready)} (${c.ready - w.day} days). Districts can be planned now.` : `${fmtPeople(c.population)} residents · ${money(c.monthRevenue)}/mo · ${money(c.invested)} invested`}
    >
      {building && <Progress value={(w.day - c.founded) / Math.max(1, c.ready - c.founded)} className="mb-4" />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-sub">
              Districts ({c.districts.length}/{c.slots} plots)
            </span>
            <Button size="sm" disabled={cash < expandCost(c)} onClick={() => act((world) => expandCity(world, c.id), `${c.name} grows`)}>
              <Plus size={12} /> 3 plots · {money(expandCost(c))}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {c.districts.map((dst) => {
              const def = DISTRICTS[dst.kind];
              const wip = w.day < dst.ready;
              const up = districtCost(w, dst.kind, dst.level + 1);
              return (
                <div key={dst.id} className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">
                      {def.emoji} {def.name}
                    </span>
                    <Pips level={dst.level} max={DISTRICT_MAX} />
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted">{def.blurb}</div>
                  <div className="mt-1.5 flex items-center justify-between gap-1.5">
                    {wip ? (
                      <span className="text-[11px] text-warn">Building until {date(dst.ready)}</span>
                    ) : dst.level < DISTRICT_MAX ? (
                      <Button size="sm" disabled={cash < up} onClick={() => act((world) => upgradeDistrict(world, c.id, dst.id), `${def.name} upgraded`)}>
                        Level {dst.level + 1} · {money(up)}
                      </Button>
                    ) : (
                      <span className="text-[11px] text-good">Fully developed</span>
                    )}
                    <ConfirmButton variant="ghost" onConfirm={() => act((world) => demolishDistrict(world, c.id, dst.id))} confirmLabel="Demolish?">
                      ✕
                    </ConfirmButton>
                  </div>
                </div>
              );
            })}
            {free > 0 && (
              <div className="rounded-lg border border-dashed border-line p-2.5">
                <div className="text-xs font-medium text-sub">
                  {free} empty plot{free === 1 ? '' : 's'}
                </div>
                <select aria-label="District" className={cx(inputClass, 'mt-1.5 h-8 text-xs')} value={kind} onChange={(e) => setKind(e.target.value as DistrictKind)}>
                  {DISTRICT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {DISTRICTS[k].emoji} {DISTRICTS[k].name} · {money(districtCost(w, k, 1))}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-snug text-muted">{DISTRICTS[kind].blurb}</p>
                <Button size="sm" variant="primary" className="mt-1.5 w-full" disabled={cash < districtCost(w, kind, 1)} onClick={() => act((world) => buildDistrict(world, c.id, kind), `${DISTRICTS[kind].name} under construction`)}>
                  Build
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-3">
          <Meter label="Happiness" value={c.happiness} tone={c.happiness < 40 ? 'bad' : c.happiness < 60 ? 'warn' : 'good'} />
          <Meter label="Unrest" value={c.unrest} tone={c.unrest > 60 ? 'bad' : c.unrest > 35 ? 'warn' : 'good'} right={c.unrest > 60 ? `${Math.round(c.unrest)} · riots near` : undefined} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.autopilot} onChange={(e) => act((world) => setCity(world, c.id, { autopilot: e.target.checked }))} /> City manager
            <span className="text-xs text-muted">(adjusts tax and services)</span>
          </label>
          <Field label="City tax" hint={pct(c.tax)}>
            <input type="range" min={0} max={0.4} step={0.01} value={c.tax} disabled={c.autopilot} onChange={(e) => act((world) => setCity(world, c.id, { tax: Number(e.target.value) }))} className="w-full disabled:opacity-40" />
          </Field>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">Public services</span>
            <Choice options={['Bare', 'Basic', 'Good', 'Lavish'].map((label, id) => ({ id, label }))} value={c.services} onChange={(v) => act((world) => setCity(world, c.id, { services: v }))} />
          </div>
          {series && <TimeChart height={110} format={fmtPeople} series={[{ key: 'pop', name: 'Residents', color: '#199e70', data: c.history }]} />}
        </div>
      </div>
      {!c.districts.length && !building && <Empty title="An empty city">Build a residential district first: people need somewhere to live.</Empty>}
    </Card>
  );
}
