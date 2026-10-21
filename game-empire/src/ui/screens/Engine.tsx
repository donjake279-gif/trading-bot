import { useState } from 'react';
import { AlertTriangle, Check, Cpu, Flame, FlaskConical, Handshake, Lock, Pencil, Rocket, Sparkles, Users, Wrench, X } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { ENGINES, ENGINE_MAX_LEVEL, ENGINE_MODULES, ENGINE_MODULE_IDS, GENRES, GENRE_IDS, RESEARCH, ROLES, engineShowcaseCost } from '../../engine/constants';
import { ENGINE_FEATURES, FEATURE_BY_ID, featureCost, type EngineFeature } from '../../engine/engineTech';
import {
  ENGINE_TEAM,
  FOCUS_COOLDOWN,
  MAX_QUEUE,
  REFACTOR_DAYS,
  activeDeal,
  canFoundEngine,
  cancelResearch,
  commercialScore,
  engineLicensees,
  engineMarketShare,
  engineScore,
  engineSpeed,
  engineTeam,
  featureDays,
  featuresIn,
  foundEngine,
  queueResearch,
  readyForVersion,
  refactorCost,
  releaseEngineVersion,
  renameEngine,
  researchBlocker,
  researchSlots,
  satisfactionTarget,
  setEngineArch,
  setEngineCrunch,
  setEngineFocus,
  setEngineSource,
  setLicensing,
  startRefactor,
  studioEngineStats,
  suggestEngineName,
  supportCoverage,
  unqueueResearch,
  unreleasedFeatures,
} from '../../engine/studioEngine';
import { assignEmployee } from '../../engine/actions';
import { gamesOf, playerCompany } from '../../engine/util';
import type { EngineArch, EngineId, EngineSource, GenreId, StudioEngine } from '../../engine/types';
import { date, money, pct } from '../lib/format';
import { Donut } from '../components/charts';
import { Badge, Button, Card, ConfirmButton, Empty, Progress, SectionTitle, Stat, Tabs, cx, inputClass } from '../components/ui';

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
            The biggest studios run on their own tech. Found an engine, grow it through a tech tree of {ENGINE_FEATURES.length} features with your own engine team, choose its architecture and genre focus, ship versions 1.0 to 5.0, and license it to rival studios.
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

/** Plain-language summary of what a feature does. */
export function fxText(f: EngineFeature): string[] {
  const x = f.fx;
  const out: string[] = [];
  const who = [
    ...(x.art ?? []).map((a) => a.replace('photoreal', 'photoreal').replace('handDrawn', 'hand-drawn').replace('lowPoly', 'low-poly')),
    ...(x.genres ?? []).map((g) => GENRES[g].name),
    ...(x.mp ?? []).map((m) => (m === 'localCoop' ? 'co-op' : m === 'massive' ? 'MMO' : m)),
    ...(x.platforms ?? []).map((p) => (p === 'vr' ? 'VR' : p)),
  ];
  if (x.match) out.push(`+${x.match} quality: ${who.slice(0, 4).join(', ')}${who.length > 4 ? '…' : ''}`);
  if (x.cap) out.push(`+${x.cap} quality ceiling`);
  if (x.quality) out.push(`+${x.quality} quality for every game`);
  if (x.work) out.push(`−${Math.round(x.work * 100)}% development work`);
  if (x.patch) out.push(`−${Math.round(x.patch * 100)}% patch work`);
  if (x.bugs) out.push(`−${Math.round(x.bugs * 100)}% bugs`);
  if (x.server) out.push(`−${Math.round(x.server * 100)}% server costs`);
  if (x.port) out.push(`−${Math.round(x.port * 100)}% port work`);
  if (x.churn) out.push(`−${Math.round(x.churn * 100)}% churn${x.genres || x.mp ? ' (matching games)' : ''}`);
  if (x.adoption) out.push('More studios license it');
  return out;
}

type Tab = 'overview' | 'tree' | 'build' | 'licensing';

function EngineDashboard() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const e = w.player.engine!;
  const p = playerCompany(w);
  const [tab, setTab] = useState<Tab>('tree');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(e.name);
  const score = engineScore(e);
  const stats = studioEngineStats(w, null);
  const ready = readyForVersion(e);
  const showcase = engineShowcaseCost(e.version + 1);
  const myGames = gamesOf(w, p.id).filter((g) => g.engine === 'inhouse' && g.status !== 'cancelled').length;
  const lic = engineLicensees(w);
  const notes = unreleasedFeatures(e);
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
              <Badge tone="accent">Buzz {Math.round(e.hype)}</Badge>
              <Badge>{e.features.length} features</Badge>
              <Badge>{myGames} of your games</Badge>
              <Badge tone={lic.length ? 'good' : 'neutral'}>{lic.length} studios licensing</Badge>
              <Badge tone={e.source === 'open' ? 'good' : 'neutral'}>{e.source === 'open' ? 'Open source' : e.source === 'sourceAvailable' ? 'Source available' : 'Closed source'}</Badge>
              {w.day < e.refactorUntil && <Badge tone="warn">Refactoring until {date(e.refactorUntil)}</Badge>}
              {w.day < e.vulnUntil && (
                <Badge tone="bad">
                  <AlertTriangle size={10} /> Unpatched hole
                </Badge>
              )}
            </div>
            <div className="mt-2 grid max-w-2xl grid-cols-2 gap-2 text-xs sm:grid-cols-4">
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
              <div>
                <div className="text-muted">Tech debt</div>
                <div className={cx('font-semibold tabular', e.debt > 50 ? 'text-bad' : e.debt > 25 ? 'text-warn' : 'text-good')}>{Math.round(e.debt)}/100</div>
              </div>
            </div>
          </div>
          {e.version < ENGINE_MAX_LEVEL && (
            <div className={cx('w-full rounded-lg border p-3 sm:w-80', ready ? 'border-good/40 bg-good-soft/30' : 'border-line bg-surface-2')}>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Rocket size={14} className={ready ? 'text-good' : 'text-muted'} /> Ship {e.name} {e.version + 1}.0
              </div>
              <div className="mt-1 text-xs text-muted">
                {ready ? `${notes.length} new feature${notes.length === 1 ? '' : 's'} in the release notes.` : `Every module needs ${e.version} feature${e.version === 1 ? '' : 's'} (${ENGINE_MODULE_IDS.filter((m) => e.modules[m] <= e.version).length} module${ENGINE_MODULE_IDS.filter((m) => e.modules[m] <= e.version).length === 1 ? '' : 's'} to go).`}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Button size="sm" disabled={!ready} onClick={() => act((world) => releaseEngineVersion(world, false))}>
                  Quiet release
                </Button>
                <Button size="sm" variant="primary" disabled={!ready || p.cash < showcase} onClick={() => act((world) => releaseEngineVersion(world, true))} title="A tech demo: more buzz and fans">
                  Tech demo · {money(showcase)}
                </Button>
              </div>
            </div>
          )}
          {e.version >= ENGINE_MAX_LEVEL && <Badge tone="good">Version 5: a world-class engine</Badge>}
        </div>
      </Card>

      <div className="overflow-x-auto">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'tree', label: `Tech tree (${e.features.length}/${ENGINE_FEATURES.length})` },
            { id: 'build', label: 'Team & architecture' },
            { id: 'licensing', label: `Licensing (${lic.length})` },
            { id: 'overview', label: 'Market & log' },
          ]}
        />
      </div>
      {tab === 'tree' && <TechTree />}
      {tab === 'build' && <BuildTab />}
      {tab === 'licensing' && <LicensingTab />}
      {tab === 'overview' && <MarketTab />}
    </div>
  );
}

// ------------------------------------------------------------ tech tree

function TechTree() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const e = w.player.engine!;
  const slots = researchSlots(w);
  return (
    <div className="space-y-4">
      <Card
        title="Research"
        subtitle={`${e.research.length}/${slots} slot${slots === 1 ? '' : 's'} busy · speed ×${engineSpeed(w).toFixed(2)} · ${engineTeam(w).length} on the engine team. Click a feature to research it or queue it (up to ${MAX_QUEUE}).`}
      >
        {e.research.length === 0 && e.queue.length === 0 ? (
          <p className="text-sm text-sub">Nothing in progress. Pick features below. A module's level is 1 + its features (up to 5); every module needs {e.version} to ship {e.version + 1}.0.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {e.research.map((r) => {
              const f = FEATURE_BY_ID[r.feature];
              return (
                <div key={r.feature} className="rounded-lg border border-accent/40 bg-accent-soft/20 p-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Wrench size={12} className="text-accent" /> {f?.name}
                      {r.crunched && <Flame size={11} className="text-warn" />}
                    </span>
                    <ConfirmButton variant="ghost" onConfirm={() => act((world) => cancelResearch(world, r.feature))} confirmLabel="Cancel? Money is lost">
                      <X size={12} />
                    </ConfirmButton>
                  </div>
                  <Progress value={r.done} max={r.work} className="mt-1.5" />
                  <div className="mt-1 text-[11px] text-muted">{w.day < e.refactorUntil ? 'Paused for the refactor' : `${Math.ceil((r.work - r.done) / engineSpeed(w))} days left`}</div>
                </div>
              );
            })}
            {e.queue.map((id, i) => (
              <div key={id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-xs">
                <span className="min-w-0">
                  <span className="text-muted">#{i + 1}</span> {FEATURE_BY_ID[id]?.name}
                  {(() => {
                    const why = researchBlocker(w, id);
                    return why && !/slot/.test(why) ? <span className="block text-[10px] text-warn">Waiting: {why}</span> : null;
                  })()}
                </span>
                <button onClick={() => act((world) => unqueueResearch(world, id))} className="text-muted hover:text-bad" aria-label="Remove from queue">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ENGINE_MODULE_IDS.map((m) => (
          <Card key={m} title={`${ENGINE_MODULES[m].name} · level ${e.modules[m]}`} subtitle={ENGINE_MODULES[m].blurb}>
            <div className="space-y-1.5">
              {ENGINE_FEATURES.filter((f) => f.module === m).map((f) => (
                <FeatureCard key={f.id} f={f} />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FeatureCard({ f }: { f: EngineFeature }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const e = w.player.engine!;
  const done = e.features.includes(f.id);
  const active = e.research.find((r) => r.feature === f.id);
  const qi = e.queue.indexOf(f.id);
  const blocker = researchBlocker(w, f.id, false);
  const locked = !done && !active && qi < 0 && blocker && !/slot|Costs|refactoring/.test(blocker);
  const click = () => {
    if (done || active) return;
    if (qi >= 0) act((world) => unqueueResearch(world, f.id));
    else {
      const queued = !!researchBlocker(w, f.id);
      act((world) => queueResearch(world, f.id), queued ? `${f.name} queued` : `Researching ${f.name}`);
    }
  };
  return (
    <button
      onClick={click}
      disabled={done || !!active || !!locked}
      title={locked ? blocker ?? undefined : f.blurb}
      className={cx(
        'w-full rounded-lg border p-2 text-left transition-colors',
        done ? 'border-good/40 bg-good-soft/20' : active ? 'border-accent bg-accent-soft/30' : qi >= 0 ? 'border-accent/50 border-dashed bg-surface-2' : locked ? 'border-line-soft bg-surface-2 opacity-50' : 'border-line bg-surface-2 hover:border-accent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {done ? <Check size={12} className="text-good" /> : locked ? <Lock size={11} className="text-muted" /> : null}
          {f.name}
        </span>
        <span className="shrink-0 text-[10px] tabular text-muted">
          T{f.tier}
          {!done && ` · ${money(featureCost(f))} · ${featureDays(w, f.id)}d`}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {fxText(f).map((t) => (
          <span key={t} className="rounded bg-surface-3 px-1 text-[10px] text-sub">
            {t}
          </span>
        ))}
      </div>
      {active && <Progress value={active.done} max={active.work} className="mt-1.5" height={4} />}
      {qi >= 0 && <div className="mt-1 text-[10px] text-accent">Queued #{qi + 1} (click to remove)</div>}
      {locked && <div className="mt-1 text-[10px] text-warn">{blocker}</div>}
      {f.requires && !done && <div className="mt-0.5 text-[10px] text-muted">Needs {f.requires.map((r) => FEATURE_BY_ID[r]?.name).join(', ')}</div>}
    </button>
  );
}

// ------------------------------------------------------------ team & architecture

const SOURCES: Record<EngineSource, { name: string; blurb: string }> = {
  closed: { name: 'Closed source', blurb: 'Full control. Charge what you like.' },
  sourceAvailable: { name: 'Source available', blurb: 'Licensees can read the code: happier studios, a little more interest.' },
  open: { name: 'Open source', blurb: 'Huge adoption, community speeds research and pays down debt. No upfront fees, royalties capped at 2%. Closing it again causes a backlash.' },
};

function BuildTab() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const e = w.player.engine!;
  const team = engineTeam(w);
  const devs = w.player.employees.filter((x) => ROLES[x.role].dev && x.assignment !== ENGINE_TEAM);
  const [adding, setAdding] = useState('');
  const [arch, setArch] = useState<EngineArch>(e.arch);
  const diff = (Math.abs(arch.performance - e.arch.performance) + Math.abs(arch.usability - e.arch.usability) + Math.abs(arch.stability - e.arch.stability)) / 2;
  const setPart = (k: keyof EngineArch, v: number) => {
    const others = (['performance', 'usability', 'stability'] as const).filter((x) => x !== k);
    const rest = 100 - v;
    const cur = arch[others[0]] + arch[others[1]] || 1;
    const a = Math.round((arch[others[0]] / cur) * rest);
    setArch({ ...arch, [k]: v, [others[0]]: a, [others[1]]: rest - a } as EngineArch);
  };
  const focusLeft = e.focus.length ? Math.max(0, FOCUS_COOLDOWN - (w.day - e.focusDay)) : 0;
  return (
    <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
      <Card title={`Engine team (${team.length})`} subtitle={`Programmers count double. Every 4 people add a research slot (now ${researchSlots(w)}). Speed ×${engineSpeed(w).toFixed(2)}.`}>
        {team.length ? (
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {team.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs">
                <span className="truncate">
                  <span className="font-medium">{m.name}</span> <span className="text-muted">· {m.isFounder ? 'Founder' : ROLES[m.role].name} · {Math.round(m.skill)}</span>
                </span>
                <button onClick={() => act((world) => assignEmployee(world, m.id, null))} className="text-muted hover:text-bad" aria-label={`Take ${m.name} off the engine team`}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-sub">Nobody on the engine team: research crawls along at base speed with one slot.</p>
        )}
        <div className="mt-2 flex gap-1.5">
          <select aria-label="Add to engine team" className={cx(inputClass, 'h-8 min-w-0 flex-1 text-xs')} value={adding} onChange={(ev) => setAdding(ev.target.value)}>
            <option value="">Add someone…</option>
            {devs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.isFounder ? 'Founder' : ROLES[d.role].name} {Math.round(d.skill)}
                {d.assignment ? ` (busy)` : ''}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!adding}
            onClick={() => {
              if (act((world) => assignEmployee(world, adding, ENGINE_TEAM)).ok) setAdding('');
            }}
          >
            <Users size={12} /> Add
          </Button>
        </div>
        <label className={cx('mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2', e.crunch ? 'border-warn/50 bg-warn-soft/30' : 'border-line bg-surface-2')}>
          <input type="checkbox" className="mt-0.5" checked={e.crunch} onChange={(ev) => act((world) => setEngineCrunch(world, ev.target.checked))} />
          <span>
            <span className="flex items-center gap-1 text-xs font-semibold">
              <Flame size={12} /> Crunch
            </span>
            <span className="block text-[11px] text-muted">Research 40% faster. Tech debt piles up and the team's morale drops.</span>
          </span>
        </label>
      </Card>

      <Card title="Tech debt" subtitle="Debt slows research, makes games on the engine buggier and annoys licensees. Every feature adds some; crunch and re-architecting add more.">
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold tabular">{Math.round(e.debt)}</div>
          <Progress value={e.debt} max={100} tone={e.debt > 50 ? 'bad' : e.debt > 25 ? 'warn' : 'good'} className="flex-1" height={10} />
        </div>
        <div className="mt-2 text-xs text-muted">
          Research ×{(1 - e.debt / 250).toFixed(2)} · game bugs ×{(1 + e.debt / 200).toFixed(2)}
        </div>
        <Button className="mt-3" disabled={w.day < e.refactorUntil || e.debt < 10} onClick={() => act((world) => startRefactor(world), 'Refactor sprint started')}>
          {w.day < e.refactorUntil ? `Refactoring until ${date(e.refactorUntil)}` : `Refactor sprint · ${money(refactorCost(e))} · ${REFACTOR_DAYS} days`}
        </Button>
        <p className="mt-1 text-[11px] text-muted">Research pauses for a month while debt falls by about 40.</p>
      </Card>

      <Card title="Architecture" subtitle="Where your engineers' effort goes. Performance raises the quality ceiling and cuts server costs; usability cuts development work and wins licensees; stability cuts bugs and debt.">
        {(['performance', 'usability', 'stability'] as const).map((k) => (
          <div key={k} className="mb-2">
            <div className="flex justify-between text-xs">
              <span className="capitalize text-sub">{k}</span>
              <span className="tabular font-semibold">
                {arch[k]}%{arch[k] !== e.arch[k] && <span className="text-muted"> (now {e.arch[k]}%)</span>}
              </span>
            </div>
            <input type="range" min={10} max={80} value={arch[k]} onChange={(ev) => setPart(k, Number(ev.target.value))} className="w-full" />
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">{diff >= 5 ? `Re-architecting adds about ${Math.round(Math.min(25, diff / 2))} tech debt.` : diff >= 1 ? 'A small tweak: no debt.' : 'No change.'}</span>
          <Button size="sm" variant="primary" disabled={diff < 1} onClick={() => act((world) => setEngineArch(world, arch), 'Architecture updated')}>
            Apply
          </Button>
        </div>
      </Card>

      <Card title="Genre templates" subtitle={`Pick up to 3 genres to ship ready-made templates for: +2 quality for games in them, and studios making them are likelier to license.${focusLeft ? ` Can change again in ${focusLeft} days.` : ''}`}>
        <div className="flex flex-wrap gap-1.5">
          {GENRE_IDS.map((g: GenreId) => {
            const on = e.focus.includes(g);
            return (
              <button
                key={g}
                disabled={focusLeft > 0 || (!on && e.focus.length >= 3)}
                onClick={() => act((world) => setEngineFocus(world, on ? e.focus.filter((x) => x !== g) : [...e.focus, g]))}
                className={cx('rounded-md border px-2 py-1 text-xs disabled:opacity-40', on ? 'border-accent bg-accent-soft/50 font-medium' : 'border-line bg-surface-2 text-muted hover:text-ink')}
              >
                {GENRES[g].name}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Source model" subtitle="Who gets to see and change the code." className="xl:col-span-2">
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(SOURCES) as EngineSource[]).map((src) => (
            <SourceOption key={src} src={src} />
          ))}
        </div>
      </Card>
    </div>
  );
}

/** A source-model card. Switching to or away from open source asks twice. */
function SourceOption({ src }: { src: EngineSource }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const e = w.player.engine!;
  const [armed, setArmed] = useState(false);
  const on = e.source === src;
  const risky = !on && (src === 'open' || e.source === 'open');
  return (
    <button
      disabled={on}
      onClick={() => {
        if (risky && !armed) return setArmed(true);
        setArmed(false);
        act((world) => setEngineSource(world, src));
      }}
      onBlur={() => setArmed(false)}
      className={cx('h-full rounded-lg border p-3 text-left', on ? 'border-accent bg-accent-soft/30' : armed ? 'border-warn bg-warn-soft/30' : 'border-line bg-surface-2 hover:border-sub')}
    >
      <div className="text-sm font-semibold">{SOURCES[src].name}</div>
      <div className="mt-0.5 text-[11px] text-muted">{armed ? (src === 'open' ? 'Click again to open-source it.' : 'Click again to close the source. Developers will be furious.') : SOURCES[src].blurb}</div>
    </button>
  );
}

// ------------------------------------------------------------ licensing

function LicensingTab() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const e = w.player.engine!;
  const lic = engineLicensees(w);
  const cover = supportCoverage(e, lic.length);
  const target = satisfactionTarget(w, e, lic.length);
  const open = e.source === 'open';
  const projects = (id: string) => Object.values(w.games).filter((g) => g.companyId === id && g.engine === 'inhouse' && (g.status === 'development' || g.status === 'released')).length;
  return (
    <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
      <Card title="Pricing" subtitle="Studios compare your score, price, buzz and fans with the commercial engines.">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <input type="checkbox" className="mt-1" checked={e.licensing} onChange={(ev) => act((world) => setLicensing(world, { licensing: ev.target.checked }))} />
          <span>
            <span className="block text-sm font-medium">Open for licensing</span>
            <span className="block text-xs text-muted">Titan charges {pct(w.market.titanRoyalty, 1)} royalty.</span>
          </span>
        </label>
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-sub">Royalty on licensees' revenue{open ? ' (open source: max 2%)' : ''}</span>
              <span className="font-semibold tabular">{pct(e.royalty, 1)}</span>
            </div>
            <input type="range" min={0} max={open ? 20 : 150} value={Math.round(e.royalty * 1000)} onChange={(ev) => act((world) => setLicensing(world, { royalty: Number(ev.target.value) / 1000 }))} className="w-full" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-sub">Upfront fee per project{open ? ' (none when open source)' : ''}</span>
              <span className="font-semibold tabular">{money(e.fee)}</span>
            </div>
            <input type="range" min={0} max={100} disabled={open} value={Math.round(Math.sqrt(e.fee / 5e6) * 100)} onChange={(ev) => act((world) => setLicensing(world, { fee: Math.round((Math.pow(Number(ev.target.value) / 100, 2) * 5e6) / 1000) * 1000 }))} className="w-full disabled:opacity-40" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={e.threshold} onChange={(ev) => act((world) => setLicensing(world, { threshold: ev.target.checked }))} />
            <span>
              Royalty-free until a game earns $1M
              <span className="block text-xs text-muted">Small studios love it. You earn less from small games.</span>
            </span>
          </label>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Projects built" value={e.gamesBuilt} className="px-3 py-2" />
          <Stat label="Fees & deals" value={money(e.feesTotal)} className="px-3 py-2" />
          <Stat label="Royalties" value={money(e.royaltiesTotal)} tone={e.royaltiesTotal > 0 ? 'good' : undefined} className="px-3 py-2" />
        </div>
      </Card>

      <Card title="Developer support" subtitle="Documentation, forums and engineers on call. Happy licensees stay, build more and talk you up.">
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold tabular">{Math.round(e.satisfaction)}</div>
          <div className="flex-1">
            <Progress value={e.satisfaction} max={100} tone={e.satisfaction < 35 ? 'bad' : e.satisfaction < 60 ? 'warn' : 'good'} height={10} />
            <div className="mt-1 text-[11px] text-muted">Licensee satisfaction, heading toward {Math.round(target)}</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-sub">Support budget</span>
            <span className="font-semibold tabular">
              {money(e.support)}/mo · covers {pct(Math.min(1, cover))}
            </span>
          </div>
          <input type="range" min={0} max={100} value={Math.round(Math.sqrt(e.support / 5e6) * 100)} onChange={(ev) => act((world) => setLicensing(world, { support: Math.round((Math.pow(Number(ev.target.value) / 100, 2) * 5e6) / 1000) * 1000 }))} className="w-full" />
        </div>
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
          <li>Score {engineScore(e)} vs Titan {commercialScore(w, 'titan')}</li>
          <li>Tech debt {Math.round(e.debt)} (−{Math.round(e.debt / 3)} satisfaction)</li>
          {w.day < e.vulnUntil && <li className="text-bad">An unpatched security hole (−20)</li>}
        </ul>
      </Card>

      <Card title={`Licensees (${lic.length})`} subtitle="Studios with projects on your engine. Big studios sometimes ask for an enterprise deal: a flat yearly fee for unlimited use." className="xl:col-span-2">
        {lic.length ? (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {lic.slice(0, 30).map((id) => {
              const c = w.companies[id];
              const deal = e.deals.find((d) => d.companyId === id && d.until > w.day);
              return (
                <div key={id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
                  <span className="truncate font-medium">{c?.name}</span>
                  <span className="shrink-0 text-muted">
                    {projects(id)} project{projects(id) === 1 ? '' : 's'}
                    {deal && <Badge tone="good" className="ml-1">{money(deal.annual)}/yr deal</Badge>}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty icon={<Handshake size={20} />} title="No licensees yet">
            Open licensing and keep the engine competitive. Studios decide when they start a new project.
          </Empty>
        )}
        {e.deals.filter((d) => d.until > w.day && !activeDeal(w, d.companyId)).length === 0 && e.deals.length > 0 && (
          <div className="mt-2 text-[11px] text-muted">
            Deals:{' '}
            {e.deals.map((d) => (
              <span key={d.companyId} className="mr-2">
                {w.companies[d.companyId]?.name} {money(d.annual)}/yr until {date(d.until)}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ market & log

function MarketTab() {
  const w = useWorld();
  const e = w.player.engine!;
  const share = engineMarketShare(w);
  const total = share.reduce((s, x) => s + x.games, 0);
  const mine = share.find((x) => x.id === 'inhouse')?.games ?? 0;
  const score = engineScore(e);
  const rivals: EngineId[] = ['apex', 'titan', 'nimbus', 'pixelforge'];
  return (
    <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
      <Card title="Versus the commercial engines" subtitle="They keep improving every year. Stay ahead to win licensees and the best quality.">
        <div className="space-y-2">
          {[{ id: 'inhouse' as EngineId, name: `${e.name} (yours)`, s: score }, ...rivals.map((id) => ({ id, name: ENGINES[id].name, s: commercialScore(w, id) }))]
            .sort((a, b) => b.s - a.s)
            .map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <span className={cx('w-32 shrink-0 truncate', r.id === 'inhouse' && 'font-semibold')}>{r.name}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full" style={{ width: `${r.s}%`, background: SHARE_COLORS[r.id] }} />
                </div>
                <span className="w-8 text-right tabular">{r.s}</span>
              </div>
            ))}
        </div>
      </Card>
      <Card title="Engine market" subtitle="Rival projects in development or live, by engine">
        {total === 0 ? (
          <Empty title="No rival projects yet" />
        ) : (
          <>
            <Donut height={190} format={(n) => `${n} games`} slices={share.map((s) => ({ name: s.id === 'inhouse' ? `${e.name} (yours)` : ENGINES[s.id].name, value: s.games, color: SHARE_COLORS[s.id] }))} />
            <div className="mt-2 text-xs text-sub">
              Your share: <span className="font-semibold text-ink">{pct(mine / total, 1)}</span>
            </div>
          </>
        )}
      </Card>
      <Card title="Version history" subtitle="What shipped in each major version.">
        {e.versionLog.length ? (
          <ul className="space-y-2 text-xs">
            {[...e.versionLog].reverse().map((v) => (
              <li key={v.version}>
                <div className="font-semibold">
                  {e.name} {v.version}.0 <span className="font-normal text-muted">{date(v.day)}</span>
                </div>
                <div className="text-muted">{v.features.map((id) => FEATURE_BY_ID[id]?.name).filter(Boolean).join(', ') || 'Under-the-hood improvements'}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-sub">No major versions shipped since Engine 2.0 arrived.</p>
        )}
      </Card>
      <Card title="Engine log">
        {e.log.length ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1 text-xs">
            {e.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-muted tabular">{date(l.day)}</span>
                <span className={l.tone === 'good' ? 'text-good' : l.tone === 'bad' ? 'text-bad' : 'text-sub'}>{l.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-sub">Nothing yet.</p>
        )}
      </Card>
    </div>
  );
}

export function engineSummary(e: StudioEngine): string {
  return `${e.name} ${e.version}.0 · ${e.features.length} features · ${featuresIn(e, 'rendering')} rendering`;
}
