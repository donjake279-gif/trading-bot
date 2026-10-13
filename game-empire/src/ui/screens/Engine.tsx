import { useState } from 'react';
import { Cpu, FlaskConical, Handshake, Lock, Pencil, Rocket, Sparkles, Star, Wrench } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { ENGINES, ENGINE_MAX_LEVEL, ENGINE_MODULES, ENGINE_MODULE_IDS, RESEARCH, engineShowcaseCost, engineUpgradeCost } from '../../engine/constants';
import {
  COMMERCIAL_SCORES,
  canFoundEngine,
  engineMarketShare,
  engineScore,
  engineTeamSpeed,
  foundEngine,
  moduleUpgradeBlocker,
  readyForVersion,
  releaseEngineVersion,
  renameEngine,
  setLicensing,
  startModuleUpgrade,
  studioEngineStats,
  suggestEngineName,
  upgradeDays,
} from '../../engine/studioEngine';
import { gamesOf, playerCompany } from '../../engine/util';
import type { EngineId } from '../../engine/types';
import { money, pct } from '../lib/format';
import { Donut } from '../components/charts';
import { Badge, Button, Card, Empty, Progress, SectionTitle, Stat, cx, inputClass } from '../components/ui';

const SHARE_COLORS: Record<EngineId, string> = { inhouse: '#3987e5', titan: '#d95926', apex: '#9085e9', nimbus: '#199e70', pixelforge: '#c98500', scratch: '#5b6878' };

export function EngineScreen() {
  const w = useWorld();
  const e = w.player.engine;
  if (!e) return <FoundEngine />;
  return <EngineDashboard />;
}

function FoundEngine() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const [name, setName] = useState(() => suggestEngineName(w));
  const blocker = canFoundEngine(w);
  const r = w.player.research;
  const researching = r.active?.id === 'engine1';
  return (
    <div className="space-y-4">
      <SectionTitle>Your Engine</SectionTitle>
      <Card>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Cpu size={32} />
          </div>
          <h2 className="text-lg font-semibold">Build your own game engine</h2>
          <p className="max-w-xl text-sm text-sub">
            The biggest studios run on their own tech. Found an engine, upgrade six modules, ship major versions from 1.0 to 5.0, and license it to rival studios for fees and royalties. Your subsidiaries use it for free.
          </p>
          {blocker ? (
            <div className="mt-2 flex flex-col items-center gap-2">
              <Badge tone="warn">
                <Lock size={11} /> {researching ? `Researching: ${r.active!.days - r.active!.progress} days left` : `Needs research: ${RESEARCH.engine1.name}`}
              </Badge>
              {!researching && (
                <Button onClick={() => navigate({ name: 'office' })}>
                  <FlaskConical size={14} /> Go to R&amp;D
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-2 flex w-full max-w-md gap-2">
              <input className={inputClass} value={name} onChange={(ev) => setName(ev.target.value)} maxLength={40} placeholder="Engine name" />
              <Button variant="primary" onClick={() => act((world) => foundEngine(world, name))}>
                <Sparkles size={14} /> Found it
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ScoreRing({ score, version }: { score: number; version: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <svg viewBox="0 0 90 90" className="absolute inset-0 -rotate-90">
        <circle cx="45" cy="45" r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth="8" />
        <circle cx="45" cy="45" r={r} fill="none" stroke="var(--color-accent)" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div className="text-center leading-tight">
        <div className="text-2xl font-bold tabular">{version}.0</div>
        <div className="text-[10px] uppercase tracking-wide text-muted">score {score}</div>
      </div>
    </div>
  );
}

function EngineDashboard() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const e = w.player.engine!;
  const p = playerCompany(w);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(e.name);
  const score = engineScore(e);
  const stats = studioEngineStats(w, null);
  const ready = readyForVersion(e);
  const showcase = engineShowcaseCost(e.version + 1);
  const share = engineMarketShare(w);
  const total = share.reduce((s, x) => s + x.games, 0);
  const mine = share.find((x) => x.id === 'inhouse')?.games ?? 0;
  const myGames = gamesOf(w, p.id).filter((g) => g.engine === 'inhouse' && g.status !== 'cancelled').length;
  const licensees = new Set(Object.values(w.games).filter((g) => g.engine === 'inhouse' && g.companyId !== p.id && (g.status === 'development' || g.status === 'released')).map((g) => g.companyId));

  return (
    <div className="space-y-4">
      <SectionTitle>Your Engine</SectionTitle>
      <Card>
        <div className="flex flex-wrap items-center gap-5">
          <ScoreRing score={score} version={e.version} />
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex max-w-md gap-2">
                <input className={inputClass} value={name} onChange={(ev) => setName(ev.target.value)} maxLength={40} />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (act((world) => renameEngine(world, name)).ok) setEditing(false);
                  }}
                >
                  Save
                </Button>
              </div>
            ) : (
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                {e.name} {e.version}.0
                <button onClick={() => setEditing(true)} className="rounded p-1 text-muted hover:text-ink" aria-label="Rename engine">
                  <Pencil size={14} />
                </button>
              </h2>
            )}
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="accent">Developer buzz {Math.round(e.hype)}</Badge>
              <Badge>{myGames} of your games</Badge>
              <Badge tone={licensees.size ? 'good' : 'neutral'}>{licensees.size} studios licensing</Badge>
            </div>
            <div className="mt-2 grid max-w-xl grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted">Quality ceiling</div>
                <div className="font-semibold tabular">{Math.round(stats.cap)}</div>
              </div>
              <div>
                <div className="text-muted">Build speed</div>
                <div className="font-semibold tabular">×{(1 / stats.workMult).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted">Bugs</div>
                <div className="font-semibold tabular">×{stats.bugMult.toFixed(2)}</div>
              </div>
            </div>
          </div>
          {e.version < ENGINE_MAX_LEVEL && (
            <div className={cx('w-full rounded-lg border p-3 sm:w-72', ready ? 'border-good/40 bg-good-soft/30' : 'border-line bg-surface-2')}>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Rocket size={14} className={ready ? 'text-good' : 'text-muted'} /> Ship {e.name} {e.version + 1}.0
              </div>
              <div className="mt-1 text-xs text-muted">{ready ? 'Every module is ready. Time for a launch!' : `Upgrade every module to level ${e.version + 1}.`}</div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Button size="sm" disabled={!ready} onClick={() => act((world) => releaseEngineVersion(world, false))}>
                  Quiet release
                </Button>
                <Button size="sm" variant="primary" disabled={!ready || p.cash < showcase} onClick={() => act((world) => releaseEngineVersion(world, true))} title="A tech demo: more buzz and reputation">
                  Tech demo · {money(showcase)}
                </Button>
              </div>
            </div>
          )}
          {e.version >= ENGINE_MAX_LEVEL && <Badge tone="good">Maxed out: a world-class engine</Badge>}
        </div>
      </Card>

      <Card title="Modules" subtitle={`One upgrade at a time, up to one level past your current version. Programmers speed engine work up (×${engineTeamSpeed(w).toFixed(2)} with your team).`}>
        {e.upgrade && (
          <div className="mb-3 rounded-lg border border-accent/40 bg-accent-soft/30 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold">
                <Wrench size={14} className="text-accent" /> Upgrading {ENGINE_MODULES[e.upgrade.module].name} to level {e.modules[e.upgrade.module] + 1}
              </span>
              <span className="tabular text-sub">{e.upgrade.daysLeft} days left</span>
            </div>
            <Progress value={e.upgrade.days - e.upgrade.daysLeft} max={e.upgrade.days} className="mt-2" />
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ENGINE_MODULE_IDS.map((m) => {
            const lvl = e.modules[m];
            const blocker = moduleUpgradeBlocker(w, m);
            const { cost } = engineUpgradeCost(lvl);
            const upgrading = e.upgrade?.module === m;
            return (
              <div key={m} className={cx('flex flex-col rounded-lg border p-3', upgrading ? 'border-accent' : 'border-line bg-surface-2')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{ENGINE_MODULES[m].name}</span>
                  <span className="flex gap-0.5">
                    {Array.from({ length: ENGINE_MAX_LEVEL }, (_, k) => (
                      <Star key={k} size={12} className={k < lvl ? 'fill-accent text-accent' : 'text-line'} />
                    ))}
                  </span>
                </div>
                <p className="mt-1 flex-1 text-xs text-sub">{ENGINE_MODULES[m].blurb}</p>
                {lvl >= ENGINE_MAX_LEVEL ? (
                  <div className="mt-2 text-[11px] font-medium text-good">Maxed</div>
                ) : (
                  <Button size="sm" className="mt-2 w-full" variant={blocker ? 'secondary' : 'primary'} disabled={!!blocker} onClick={() => act((world) => startModuleUpgrade(world, m), `Upgrading ${ENGINE_MODULES[m].name}`)} title={blocker ?? undefined}>
                    {upgrading ? 'In progress' : blocker && blocker.startsWith('Ship') ? blocker : `Level ${lvl + 1} · ${money(cost)} · ${upgradeDays(w, m)}d`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Licensing" subtitle="Let rival studios build their games on your engine.">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <input type="checkbox" className="mt-1" checked={e.licensing} onChange={(ev) => act((world) => setLicensing(world, { licensing: ev.target.checked }))} />
            <span>
              <span className="block text-sm font-medium">Open for licensing</span>
              <span className="block text-xs text-muted">Studios compare your score, price and buzz with Titan ({pct(w.market.titanRoyalty, 1)} royalty) and Apex. Better versions attract bigger projects.</span>
            </span>
          </label>
          <div className="mt-3 space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-sub">Royalty on licensees' revenue</span>
                <span className="font-semibold tabular">{pct(e.royalty, 1)}</span>
              </div>
              <input type="range" min={0} max={150} value={Math.round(e.royalty * 1000)} onChange={(ev) => act((world) => setLicensing(world, { royalty: Number(ev.target.value) / 1000 }))} className="w-full" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-sub">Upfront fee per project</span>
                <span className="font-semibold tabular">{money(e.fee)}</span>
              </div>
              <input type="range" min={0} max={100} value={Math.round(Math.sqrt(e.fee / 5e6) * 100)} onChange={(ev) => act((world) => setLicensing(world, { fee: Math.round((Math.pow(Number(ev.target.value) / 100, 2) * 5e6) / 1000) * 1000 }))} className="w-full" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Projects built" value={e.gamesBuilt} className="px-3 py-2" />
            <Stat label="Fees earned" value={money(e.feesTotal)} className="px-3 py-2" />
            <Stat label="Royalties" value={money(e.royaltiesTotal)} tone={e.royaltiesTotal > 0 ? 'good' : undefined} className="px-3 py-2" />
          </div>
          {licensees.size > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Handshake size={14} className="text-muted" />
              {[...licensees].slice(0, 12).map((id) => (
                <Badge key={id}>{w.companies[id]?.name}</Badge>
              ))}
            </div>
          )}
        </Card>
        <Card title="Engine market" subtitle="Rival projects in development or live, by engine">
          {total === 0 ? (
            <Empty title="No rival projects yet" />
          ) : (
            <>
              <Donut
                height={190}
                format={(n) => `${n} games`}
                slices={share.map((s) => ({ name: s.id === 'inhouse' ? `${e.name} (yours)` : ENGINES[s.id].name, value: s.games, color: SHARE_COLORS[s.id] }))}
              />
              <div className="mt-2 space-y-1 text-xs text-sub">
                <div>
                  Your share: <span className="font-semibold text-ink">{pct(mine / total, 1)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3">
                  <span>Your score {score}</span>
                  {(['titan', 'apex', 'nimbus'] as EngineId[]).map((id) => (
                    <span key={id}>
                      {ENGINES[id].name.split(' ')[0]} {COMMERCIAL_SCORES[id]}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
