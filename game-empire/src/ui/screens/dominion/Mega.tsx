// Empire Megaprojects and Empire Emergencies.
import { Construction, ShieldCheck, Siren, Trophy } from 'lucide-react';
import { useWorld } from '../../../store/gameStore';
import { bestLevel, execPower } from '../../../engine/dominionCore';
import { MEGAPROJECTS, MEGAPROJECT_IDS, abandonMegaproject, megaBlocker, startMegaproject } from '../../../engine/megaprojects';
import { EMERGENCIES, gambleOdds, stageCost } from '../../../engine/emergencies';
import { EXEC_ROLES } from '../../../engine/executives';
import { activeCorps } from '../../../engine/megacorps';
import type { MegaprojectRun } from '../../../engine/types';
import { date, money, pct } from '../../lib/format';
import { Badge, Card, ConfirmButton, Progress, cx } from '../../components/ui';
import { DecisionCard } from '../../components/Overlays';
import { FeatureGate, Meter, Mini, useAct } from './shared';

// ------------------------------------------------------------ megaprojects

export function MegaTab() {
  const w = useWorld();
  const d = w.player.dominion;
  const pending = w.pendingEvents.filter((e) => e.kind === 'megaPhase');
  const building = d.megaprojects.filter((m) => m.stage === 'building');
  const done = d.megaprojects.filter((m) => m.stage === 'done');
  return (
    <FeatureGate f="megaprojects">
      <div className="space-y-4">
        {d.victory != null && (
          <div className="rounded-xl border border-warn/50 bg-warn-soft/30 p-4">
            <div className="flex items-center gap-2 text-base font-semibold text-warn">
              <Trophy size={18} /> The starship has left for another star
            </div>
            <p className="mt-1 text-sm text-sub">Launched {date(d.victory)}. Nothing anyone builds will ever top it. Your empire carries on.</p>
          </div>
        )}
        {pending.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {pending.map((ev) => (
              <DecisionCard key={ev.id} ev={ev} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Underway" value={`${building.length}/2`} />
          <Mini label="Completed" value={done.length} tone={done.length ? 'good' : undefined} />
          <Mini label="Spent so far" value={money(d.megaprojects.reduce((s, m) => s + m.spent, 0))} />
          <Mini label="Daily bill" value={money(building.reduce((s, m) => s + MEGAPROJECTS[m.id].budget / MEGAPROJECTS[m.id].days, 0))} tone={building.length ? 'warn' : undefined} />
        </div>
        {building.map((m) => (
          <RunCard key={m.id} m={m} />
        ))}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {MEGAPROJECT_IDS.map((id) => (
            <ProjectCard key={id} id={id} />
          ))}
        </div>
      </div>
    </FeatureGate>
  );
}

function RunCard({ m }: { m: MegaprojectRun }) {
  const w = useWorld();
  const act = useAct();
  const def = MEGAPROJECTS[m.id];
  const phases = def.phases.length;
  const overall = (m.phase + m.progress) / phases;
  const paused = w.day < m.pausedUntil;
  const daysLeft = Math.round(((1 - overall) * def.days) / (1 + 0.15 * execPower(w, 'coo')));
  return (
    <Card
      className="border-accent/40"
      title={
        <span className="flex items-center gap-1.5">
          <span className="text-lg leading-none">{def.emoji}</span> {def.name}
          {paused && <Badge tone="warn">Paused until {date(m.pausedUntil)}</Badge>}
        </span>
      }
      subtitle={`Started ${date(m.start)} · ${money(m.spent)} of ${money(m.budget)} · quality ${pct(m.quality)} · about ${daysLeft} days to go`}
      actions={
        <ConfirmButton onConfirm={() => act((world) => abandonMegaproject(world, m.id), `${def.name} abandoned`)} confirmLabel="Abandon? Rep -5">
          Abandon
        </ConfirmButton>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {def.phases.map((ph, i) => {
          const v = i < m.phase ? 1 : i === m.phase ? m.progress : 0;
          return (
            <div key={ph} className={cx('rounded-lg p-2.5', i === m.phase ? 'bg-accent-soft/30' : 'bg-surface-2')}>
              <div className="text-[11px] text-muted">Phase {i + 1}</div>
              <div className={cx('text-xs font-medium', i < m.phase ? 'text-good' : 'text-ink')}>{ph}</div>
              <Progress value={v} className="mt-1.5" tone={i < m.phase ? 'good' : 'accent'} />
            </div>
          );
        })}
      </div>
      <Progress value={overall} className="mt-3" height={8} />
      <p className="mt-2 text-xs text-sub">When finished: {def.effect}</p>
      <p className="mt-1 text-[11px] text-muted">Every phase ends with a hard call: overruns, protests, sabotage or a breakthrough. If you run out of cash, work stops.</p>
    </Card>
  );
}

function ProjectCard({ id }: { id: (typeof MEGAPROJECT_IDS)[number] }) {
  const w = useWorld();
  const act = useAct();
  const def = MEGAPROJECTS[id];
  const run = w.player.dominion.megaprojects.find((m) => m.id === id && m.stage !== 'abandoned');
  const blocker = megaBlocker(w, id);
  const racing = activeCorps(w)
    .filter((c) => (c.assets.projects[id] ?? 0) > 0)
    .map((c) => ({ c, p: c.assets.projects[id] ?? 0 }))
    .sort((a, b) => b.p - a.p);
  const status = run?.stage === 'done' ? 'done' : run?.stage === 'building' ? 'building' : null;
  return (
    <div className={cx('flex flex-col rounded-xl border bg-surface p-4', status === 'done' ? 'border-good/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">
          <span className="mr-1 text-lg leading-none">{def.emoji}</span>
          {def.name}
        </div>
        {status === 'done' ? <Badge tone="good">Complete</Badge> : status === 'building' ? <Badge tone="accent">Underway</Badge> : <span className="text-xs font-semibold tabular text-warn">{money(def.budget)}</span>}
      </div>
      <p className="mt-1 text-xs text-sub">{def.blurb}</p>
      <p className="mt-1.5 text-xs text-good">{def.effect}</p>
      <div className="mt-1.5 text-[11px] text-muted">
        {Math.round(def.days / 365 * 10) / 10} years · {def.phases.join(' → ')}
      </div>
      {racing.length > 0 && (
        <div className="mt-2 space-y-1">
          {racing.map(({ c, p }) => (
            <div key={c.id} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 shrink-0 truncate" style={{ color: c.color }}>
                {c.name}
              </span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full" style={{ width: `${p * 100}%`, background: c.color }} />
              </div>
              <span className="w-10 shrink-0 text-right tabular text-muted">{p >= 1 ? 'done' : pct(p)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto pt-3">
        {!status && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-warn">{blocker ?? ''}</span>
            <ConfirmButton variant="primary" disabled={!!blocker} onConfirm={() => act((world) => startMegaproject(world, id), `${def.name} begins`)} confirmLabel={`Commit ${money(def.budget)}?`}>
              <Construction size={13} /> Begin
            </ConfirmButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ emergencies

export function EmergenciesTab() {
  const w = useWorld();
  const d = w.player.dominion;
  const e = d.emergency;
  const crises = w.pendingEvents.filter((x) => x.kind === 'corpCrisis');
  const scars = d.scars.filter((s) => s.until > w.day);
  const severity = Math.max(1, Math.min(3, 1 + Math.floor((bestLevel(w) - 4) / 2)));
  return (
    <FeatureGate f="emergencies">
      <div className="space-y-4">
        {e ? (
          <ActiveEmergency />
        ) : (
          <Card>
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="mt-0.5 shrink-0 text-good" />
              <div>
                <div className="text-sm font-semibold">No emergency right now</div>
                <p className="mt-1 text-sm text-sub">
                  Crises hit every year or two, more often and harder the bigger you get (severity {severity} of 3 at your level). The right executive in the right seat makes all the difference: a CTO for outages and rogue AI, a CSO for breaches, General Counsel for whistleblowers and breakups, a CFO for a cash crunch.
                </p>
              </div>
            </div>
          </Card>
        )}
        {crises.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {crises.map((ev) => (
              <DecisionCard key={ev.id} ev={ev} />
            ))}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card title="Past emergencies" subtitle={`${d.stats.emergencies} so far · ${d.stats.disasters} became disasters`}>
            {d.emergencyHistory.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.emergencyHistory.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>
                      {EMERGENCIES[h.kind].emoji} {h.title} <span className="text-xs text-muted">{date(h.start)}</span>
                    </span>
                    <Badge tone={h.outcome === 'contained' ? 'good' : 'bad'}>{h.outcome}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-sub">None yet.</p>
            )}
          </Card>
          <Card title="Scars and honours" subtitle="Cutting corners leaves scars that last for years. Handling a crisis well earns trust.">
            {scars.length ? (
              <ul className="space-y-1.5 text-sm">
                {scars.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className={isGood(s) ? 'text-good' : 'text-bad'}>{s.label}</span>
                    <span className="shrink-0 text-xs text-muted">{s.until - w.day} days left</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-sub">A clean record.</p>
            )}
          </Card>
        </div>
      </div>
    </FeatureGate>
  );
}

function isGood(s: { key: string; value: number }): boolean {
  // for these keys a positive value hurts
  if (s.key === 'antitrust' || s.key === 'hardwareCost' || s.key === 'spaceRisk') return s.value < 0;
  return s.value > 0;
}

function ActiveEmergency() {
  const w = useWorld();
  const d = w.player.dominion;
  const e = d.emergency!;
  const def = EMERGENCIES[e.kind];
  const ev = w.pendingEvents.find((x) => x.kind === 'emergency');
  const exec = d.execs.find((x) => x.role === def.role);
  return (
    <Card
      className="border-bad/60"
      title={
        <span className="flex items-center gap-2 text-bad">
          <Siren size={16} className="animate-pulse" /> {def.emoji} {def.title}
        </span>
      }
      subtitle={`Since ${date(e.start)} · stage ${e.stage} of 3 · severity ${e.severity}`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
        <div className="space-y-3">
          <p className="text-sm text-sub">{def.intro}</p>
          <Meter label="Pressure: at 100 it becomes a disaster" value={e.pressure} tone={e.pressure > 70 ? 'bad' : e.pressure > 45 ? 'warn' : 'accent'} right={`${Math.round(e.pressure)}/100`} />
          {ev ? (
            <DecisionCard ev={ev} />
          ) : (
            <p className="text-xs text-muted">{e.stage >= 3 ? `If pressure stays under 100 until ${date(e.nextStage)}, it’s contained.` : `Next stage ${date(e.nextStage)}.`}</p>
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded-lg bg-surface-2 p-3 text-xs">
            <div className="font-medium text-ink">Who handles this: {EXEC_ROLES[def.role].name}</div>
            <div className={cx('mt-0.5', exec ? 'text-good' : 'text-warn')}>{exec ? `${exec.name} (skill ${exec.skill}) gives the gamble ${pct(gambleOdds(w, e))} odds.` : `Nobody in the seat: the gamble is a coin flip (${pct(gambleOdds(w, e))}).`}</div>
            <div className="mt-1 text-muted">This stage’s full fix costs {money(stageCost(w, e))}. General Counsel slows the pressure.</div>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-xs">
            {e.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-muted tabular">{date(l.day)}</span>
                <span className="text-sub">{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
