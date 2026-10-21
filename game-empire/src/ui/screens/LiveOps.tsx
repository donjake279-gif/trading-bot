// Live ops for a released game: the release schedule, the backlog for the next
// patch, the live team, the change picker and the patch history.
import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Flame, FlaskConical, Minus, Plus, Rocket, Send, Sparkles, Trash2, Users, Wrench, X } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { MONETIZATIONS, MONETIZATION_IDS, PLATFORMS, PLATFORM_IDS, ROLES, SCOPES, UPDATES, UPDATE_IDS } from '../../engine/constants';
import { assignDevs, assignEmployee, setAutoUpdates } from '../../engine/actions';
import { isAutoUpdated } from '../../engine/automation';
import {
  CADENCES,
  UPDATE_ROLES,
  WEEKDAY_NAMES,
  addPatchItems,
  clearBacklog,
  crunching,
  fitsRole,
  itemStatus,
  liveDailyWork,
  liveLevel,
  liveTeam,
  memberTask,
  movePatchItem,
  newPlan,
  nextIsMajor,
  readyItems,
  removePatchItem,
  setPatchPlan,
  shipPatchNow,
  weekdayOf,
  type ItemStatus,
} from '../../engine/patches';
import { MAX_CONTENT_LEVEL, contentLevelOf, updateCost, updateFatigue, updateWork, versionLabel } from '../../engine/updates';
import { playerCompany } from '../../engine/util';
import type { Game, MonetizationId, PatchItem, PatchPlan, PlatformId, QueuedUpdate, UpdateTypeId } from '../../engine/types';
import { date, days, money } from '../lib/format';
import { Badge, Button, Card, ConfirmButton, Progress, ScoreBadge, cx, inputClass } from '../components/ui';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function scheduleLabel(plan: PatchPlan): string {
  if (!plan.scheduled) return 'Ships when ready';
  return plan.everyWeeks === 1 ? `Every ${WEEKDAY_NAMES[plan.weekday]}` : plan.everyWeeks === 2 ? `Every other ${WEEKDAY_NAMES[plan.weekday]}` : `Every ${plan.everyWeeks} weeks on ${WEEKDAY_NAMES[plan.weekday]}`;
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button onClick={onClick} title={title} className={cx('rounded-md border px-2 py-1 text-xs font-medium transition-colors', on ? 'border-accent bg-accent-soft/50 text-ink' : 'border-line bg-surface-2 text-muted hover:text-ink')}>
      {children}
    </button>
  );
}

function Toggle({ id, checked, onChange, title, hint, icon }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; hint: string; icon?: React.ReactNode }) {
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2', checked ? 'border-accent/50 bg-accent-soft/20' : 'border-line bg-surface-2')}>
      <input id={id} type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {icon}
          {title}
        </span>
        <span className="block text-[11px] leading-snug text-muted">{hint}</span>
      </span>
    </label>
  );
}

const STATUS_TEXT: Record<ItemStatus, string> = { waiting: 'In line', unpaid: 'Starting', working: 'In progress', testing: 'Public test', ready: 'Ready' };

export function LiveOpsPanel({ g }: { g: Game }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const plan = g.patchPlan ?? newPlan(w);
  const set = (s: Parameters<typeof setPatchPlan>[2], msg?: string) => act((world) => setPatchPlan(world, g.id, s), msg);
  const ready = readyItems(w, plan);
  const auto = isAutoUpdated(w, g);
  const until = plan.nextDay - w.day;
  const major = nextIsMajor(plan);
  return (
    <Card
      className="mt-4"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <CalendarClock size={15} className="text-accent" /> Live ops
          <span className="text-xs font-normal text-muted">
            {versionLabel(g)} · {plan.patches} patch{plan.patches === 1 ? '' : 'es'} · size level {contentLevelOf(g)}
            {contentLevelOf(g) >= MAX_CONTENT_LEVEL ? ' (max)' : ''}
          </span>
          {plan.streak >= 2 && (
            <Badge tone="warn" title="Patches shipped on schedule in a row: players trust you, so fewer leave and patches go down better">
              <Flame size={11} /> {plan.streak} on time
            </Badge>
          )}
        </span>
      }
      subtitle="Your live team works through the backlog in parallel, each person on what their role is good at. Everything finished by patch day ships together as one patch."
      actions={
        <Button size="sm" variant="primary" disabled={!ready.length} onClick={() => act((world) => shipPatchNow(world, g.id), 'Patch shipped')} title={ready.length ? 'Ship everything that’s ready now, without waiting for patch day' : 'Nothing is ready yet'}>
          <Send size={13} /> Ship {ready.length || ''} now
        </Button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        {/* schedule */}
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Release schedule</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface p-1">
            <button onClick={() => set({ scheduled: true }, 'Patches now ship on a schedule')} className={cx('rounded-md px-2 py-1.5 text-xs font-medium', plan.scheduled ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink')}>
              On a schedule
            </button>
            <button onClick={() => set({ scheduled: false }, 'Patches now ship as soon as they’re ready')} className={cx('rounded-md px-2 py-1.5 text-xs font-medium', !plan.scheduled ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink')}>
              When ready
            </button>
          </div>
          {plan.scheduled && (
            <>
              <div>
                <div className="mb-1 text-[11px] text-muted">Patch day</div>
                <div className="flex flex-wrap gap-1">
                  {WEEK_ORDER.map((d) => (
                    <Chip key={d} on={plan.weekday === d} onClick={() => set({ weekday: d }, `Patch day is now ${WEEKDAY_NAMES[d]}`)}>
                      {SHORT_DAYS[d]}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted">How often</div>
                <div className="flex flex-wrap gap-1">
                  {CADENCES.map((n) => (
                    <Chip key={n} on={plan.everyWeeks === n} onClick={() => set({ everyWeeks: n })}>
                      {n === 1 ? 'Weekly' : `${n} wks`}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                <div className="font-semibold text-ink">{scheduleLabel(plan)}</div>
                <div className="mt-0.5 text-muted">
                  Next: {WEEKDAY_NAMES[weekdayOf(plan.nextDay)]}, {date(plan.nextDay)} ({until <= 0 ? 'today' : `in ${until} day${until === 1 ? '' : 's'}`})
                  {major && plan.majorEvery > 0 && <span className="text-accent"> · a major update</span>}
                </div>
                <div className="mt-0.5 text-muted">
                  Best streak {plan.bestStreak} · slipped {plan.slipped}
                </div>
              </div>
            </>
          )}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">Ship when at least</span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => set({ minItems: plan.minItems - 1 })} disabled={plan.minItems <= 1} title="Fewer">
                <Minus size={12} />
              </Button>
              <span className="w-16 text-center font-semibold tabular">
                {plan.minItems} change{plan.minItems === 1 ? '' : 's'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => set({ minItems: plan.minItems + 1 })} disabled={plan.minItems >= 6} title="More">
                <Plus size={12} />
              </Button>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted">Major update every</span>
            <span className="flex flex-wrap gap-1">
              {[0, 2, 3, 4, 6].map((n) => (
                <Chip key={n} on={plan.majorEvery === n} onClick={() => set({ majorEvery: n })} title={n ? `Every ${n}th patch is a major update: extra hype, and your lead saves big content for it` : 'No major updates'}>
                  {n ? `${n} patches` : 'Off'}
                </Chip>
              ))}
            </span>
          </div>
          <div className="grid gap-1.5">
            <Toggle id={`auto-${g.id}`} checked={auto} onChange={(v) => act((world) => setAutoUpdates(world, g.id, v))} title="Live-ops lead plans the backlog" hint="Fixes when bugs pile up, a small change every patch, content and events on a rhythm, expansions for major updates, ports for hits." icon={<Sparkles size={12} />} />
            <Toggle id={`ts-${g.id}`} checked={plan.testServer} onChange={(v) => set({ testServer: v })} title="Public test server" hint="Finished changes spend a week in public testing: about a third of the new bugs, and better reception." icon={<FlaskConical size={12} />} />
            <Toggle id={`cr-${g.id}`} checked={plan.crunch} onChange={(v) => set({ crunch: v })} title="Crunch before patch day" hint="The team works 35% faster for three days before each patch day. Morale drops and more bugs slip in." icon={<Flame size={12} />} />
          </div>
        </div>

        {/* backlog */}
        <Backlog g={g} plan={plan} />

        {/* team */}
        <LiveTeam g={g} plan={plan} />
      </div>
      <AddChanges g={g} plan={plan} />
    </Card>
  );
}

function Backlog({ g, plan }: { g: Game; plan: PatchPlan }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const ready = readyItems(w, plan).length;
  const daily = liveDailyWork(w, g);
  const team = liveTeam(w, g);
  const left = plan.backlog.reduce((s, i) => s + Math.max(0, i.work - i.done), 0);
  const crew = plan.backlog.reduce((s, i) => s + (i.ready === null ? i.crew : 0), 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          Backlog ({plan.backlog.length}) · {ready} ready
        </div>
        {plan.backlog.length > 0 && (
          <ConfirmButton variant="ghost" onConfirm={() => act((world) => clearBacklog(world, g.id), 'Backlog cleared')} confirmLabel="Clear all?">
            <Trash2 size={12} />
          </ConfirmButton>
        )}
      </div>
      {plan.backlog.length ? (
        <>
          <div className="mt-2 space-y-1.5">
            {plan.backlog.map((it, i) => (
              <BacklogRow key={it.id} g={g} plan={plan} it={it} index={i} />
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted">
            {daily + crew > 0 ? `About ${days(left / (daily + crew))} of work left` : 'Nobody is working on it'}
            {crew > 0 && ` · ${crew} contractors`}
            {team.some((e) => crunching(w, plan) && e) && <span className="text-warn"> · crunching</span>}
          </div>
        </>
      ) : (
        <div className="mt-2 rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
          Nothing planned. Add changes below{isAutoUpdated(w, g) ? ', or let your live-ops lead fill it' : ''}.
        </div>
      )}
    </div>
  );
}

function BacklogRow({ g, plan, it, index }: { g: Game; plan: PatchPlan; it: PatchItem; index: number }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const st = itemStatus(w, it, index, plan);
  const team = liveTeam(w, g);
  const suited = team.some((e) => fitsRole(e, it.type));
  const tone = st === 'ready' ? 'good' : st === 'testing' ? 'accent' : st === 'working' ? 'neutral' : 'neutral';
  return (
    <div className={cx('rounded-lg border px-2.5 py-2', st === 'ready' ? 'border-good/40 bg-good-soft/20' : 'border-line bg-surface-2')}>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {UPDATES[it.type].name}
          {it.platform ? ` · ${PLATFORMS[it.platform].name}` : ''}
          {it.type === 'monetization' && it.monetization ? ` · ${MONETIZATIONS[it.monetization].short}` : ''}
        </span>
        {it.auto && (
          <Badge tone="neutral" title="Planned by your live-ops lead">
            auto
          </Badge>
        )}
        <Badge tone={tone}>{st === 'testing' && it.ready !== null ? `Test · ${it.ready - w.day}d` : STATUS_TEXT[st]}</Badge>
        <button onClick={() => act((world) => movePatchItem(world, g.id, it.id, -1))} disabled={index === 0} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move up">
          <ChevronUp size={13} />
        </button>
        <button onClick={() => act((world) => movePatchItem(world, g.id, it.id, 1))} disabled={index === plan.backlog.length - 1} className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move down">
          <ChevronDown size={13} />
        </button>
        <button onClick={() => act((world) => removePatchItem(world, g.id, it.id))} className="text-muted hover:text-bad" aria-label="Remove">
          <X size={13} />
        </button>
      </div>
      <Progress value={it.done} max={it.work} tone={st === 'ready' ? 'good' : 'accent'} className="mt-1.5" height={4} />
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>
          {Math.round((it.done / it.work) * 100)}%{it.crew ? ` · ${it.crew} contractors` : ''}
          {st !== 'ready' && st !== 'testing' && !suited && team.length > 0 && <span className="text-warn"> · nobody suited, slower</span>}
        </span>
        <span>{it.paid ? `paid ${money(it.cost)}` : `${money(updateCost(g, it.type, it.platform))} when it starts`}</span>
      </div>
    </div>
  );
}

function LiveTeam({ g, plan }: { g: Game; plan: PatchPlan }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const team = liveTeam(w, g);
  const devs = w.player.employees.filter((e) => ROLES[e.role].dev);
  const idle = devs.filter((e) => !e.assignment);
  const others = devs.filter((e) => e.assignment !== g.id);
  const [adding, setAdding] = useState('');
  const roles = new Set(team.map((e) => e.role));
  const hasAll = roles.has('founder');
  const gaps: string[] = [];
  if (!hasAll && !roles.has('qa')) gaps.push('No QA: more new bugs slip into each patch');
  if (!hasAll && !roles.has('artist') && plan.backlog.some((i) => UPDATE_ROLES[i.type].includes('artist') && !UPDATE_ROLES[i.type].some((r) => roles.has(r)))) gaps.push('No artist: cosmetics and events go slower');
  if (!hasAll && !roles.has('programmer') && plan.backlog.some((i) => i.type === 'hotfix' || i.type === 'port' || i.type === 'performance')) gaps.push('No programmer: fixes and ports go slower');
  const max = SCOPES[g.scope].maxTeam;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Live team ({team.length})</div>
        <span className="text-[11px] text-muted">{liveDailyWork(w, g, team).toFixed(1)} work/day</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
        <span className="text-muted" title="A dedicated team stays on the game between patches and tops itself up from idle developers">
          Dedicated team
        </span>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={plan.teamTarget <= 0} onClick={() => act((world) => setPatchPlan(world, g.id, { teamTarget: plan.teamTarget - 1 }))} title="Smaller">
            <Minus size={12} />
          </Button>
          <span className="w-20 text-center font-semibold tabular">{plan.teamTarget ? `${plan.teamTarget} people` : 'Only when busy'}</span>
          <Button size="sm" variant="ghost" disabled={plan.teamTarget >= max} onClick={() => act((world) => setPatchPlan(world, g.id, { teamTarget: plan.teamTarget + 1 }))} title="Bigger">
            <Plus size={12} />
          </Button>
        </span>
      </div>
      {team.length ? (
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
          {team.map((e) => {
            const task = memberTask(e, plan);
            const lvl = liveLevel(e);
            return (
              <div key={e.id} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{e.name}</span>
                    {lvl > 0 && (
                      <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent" title={`Live-ops level ${lvl}: +${lvl * 3}% patch output`}>
                        LO {lvl}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {e.isFounder ? 'Founder' : ROLES[e.role].name} · {Math.round(e.skill)}
                    {task ? ` · on ${UPDATES[task.type].name}${fitsRole(e, task.type) ? '' : ' (off-role)'}` : ' · free'}
                  </div>
                </div>
                <button onClick={() => act((world) => assignEmployee(world, e.id, null))} className="text-muted hover:text-bad" aria-label={`Take ${e.name} off the team`}>
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{w.player.liveOps.crew ? 'Nobody on the team: contractors build changes the lead plans or that nobody else is on.' : 'Nobody on the team. Add developers to work on the backlog.'}</p>
      )}
      {gaps.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-warn">
          {gaps.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" disabled={!idle.length} onClick={() => act((world) => assignDevs(world, g.id, 'idle'), 'Idle developers joined the live team')}>
          <Users size={12} /> Add idle ({idle.length})
        </Button>
        <select aria-label="Add a developer" className={cx(inputClass, 'h-7 w-auto min-w-0 flex-1 px-2 text-xs')} value={adding} onChange={(ev) => setAdding(ev.target.value)}>
          <option value="">Add someone…</option>
          {others.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.isFounder ? 'Founder' : ROLES[e.role].name} {Math.round(e.skill)}
              {e.assignment ? ` (on ${w.games[e.assignment]?.title ?? 'a contract'})` : ''}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!adding}
          onClick={() => {
            const r = act((world) => assignEmployee(world, adding, g.id));
            if (r.ok) setAdding('');
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function AddChanges({ g, plan }: { g: Game; plan: PatchPlan }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const [draft, setDraft] = useState<Partial<Record<UpdateTypeId, number>>>({});
  const [platform, setPlatform] = useState<PlatformId | ''>('');
  const [mon, setMon] = useState<MonetizationId>(g.monetization);
  const portOptions = PLATFORM_IDS.filter((p) => !g.platforms.includes(p) && !plan.backlog.some((i) => i.platform === p));
  const items: QueuedUpdate[] = [];
  for (const t of UPDATE_IDS) for (let i = 0; i < (draft[t] ?? 0); i++) items.push({ type: t, platform: t === 'port' ? platform || undefined : undefined, monetization: t === 'monetization' ? mon : undefined });
  const cost = items.reduce((s, it) => s + updateCost(g, it.type, it.platform), 0);
  const work = items.reduce((s, it) => s + updateWork(w, g, it.type, true, it.platform), 0);
  const daily = liveDailyWork(w, g);
  const bump = (t: UpdateTypeId, d: number) => {
    const max = t === 'port' || t === 'monetization' ? 1 : 4;
    setDraft({ ...draft, [t]: Math.max(0, Math.min(max, (draft[t] ?? 0) + d)) });
  };
  const submit = () => {
    const r = act((world) => addPatchItems(world, g.id, items), `${items.length} change${items.length === 1 ? '' : 's'} added to the backlog`);
    if (r.ok) setDraft({});
  };
  return (
    <div className="mt-5 border-t border-line-soft pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Add changes</div>
        <div className="text-[11px] text-muted">Mix it up: patches with several kinds of change go down better, and repeating the same kind tires players.</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-5">
        {UPDATE_IDS.map((t) => {
          const n = draft[t] ?? 0;
          const tired = updateFatigue(w, g, t);
          return (
            <div key={t} className={cx('rounded-lg border p-2', n ? 'border-accent bg-accent-soft/30' : 'border-line bg-surface-2')} title={UPDATES[t].blurb}>
              <div className="flex items-start justify-between gap-1">
                <span className="text-xs font-semibold leading-tight">{UPDATES[t].name}</span>
                {tired > 0 && <span className="shrink-0 text-[10px] font-medium text-warn">−{tired}</span>}
              </div>
              <div className="mt-0.5 text-[10px] text-muted">
                {money(updateCost(g, t))} · {UPDATE_ROLES[t].map((r) => ROLES[r].plural.toLowerCase()).slice(0, 2).join(', ')}
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <Button size="sm" variant="ghost" disabled={!n} onClick={() => bump(t, -1)} title="Fewer">
                  <Minus size={12} />
                </Button>
                <span className="text-sm font-semibold tabular">{n}</span>
                <Button size="sm" variant="ghost" onClick={() => bump(t, 1)} title="Add">
                  <Plus size={12} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {(draft.port ?? 0) > 0 && (
        <select className={cx(inputClass, 'mt-2 sm:w-72')} value={platform} onChange={(e) => setPlatform(e.target.value as PlatformId)}>
          <option value="">Port to which platform?</option>
          {portOptions.map((p) => (
            <option key={p} value={p} disabled={c.reputation < PLATFORMS[p].minRep}>
              {PLATFORMS[p].name} {c.reputation < PLATFORMS[p].minRep ? `(rep ${PLATFORMS[p].minRep})` : ''}
            </option>
          ))}
        </select>
      )}
      {(draft.monetization ?? 0) > 0 && (
        <select className={cx(inputClass, 'mt-2 sm:w-72')} value={mon} onChange={(e) => setMon(e.target.value as MonetizationId)}>
          {MONETIZATION_IDS.map((m) => (
            <option key={m} value={m}>
              {m === g.monetization ? `${MONETIZATIONS[m].name} (keep: new battle pass season)` : MONETIZATIONS[m].name}
            </option>
          ))}
        </select>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {items.length ? (
            <>
              {items.length} change{items.length === 1 ? '' : 's'} · {money(cost)} (paid as work starts) · {daily > 0 ? `about ${days(work / daily)} with this team` : w.player.liveOps.crew ? 'contractors will build it' : 'needs people on the live team'}
            </>
          ) : (
            'Pick changes with + and add them to the backlog.'
          )}
        </span>
        <Button variant="primary" disabled={!items.length || (items.some((i) => i.type === 'port') && !platform)} onClick={submit}>
          <Wrench size={14} /> Add {items.length || ''} to backlog
        </Button>
      </div>
    </div>
  );
}

export function PatchHistory({ g }: { g: Game }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!g.updates.length) return null;
  const list = [...g.updates].reverse();
  return (
    <Card className="mt-4" title="Patch history" subtitle="Click a patch for its notes." pad={false}>
      <div className="divide-y divide-line-soft">
        {list.map((u, i) => (
          <div key={i}>
            <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2">
              {u.major ? <Rocket size={14} className="shrink-0 text-accent" /> : <Wrench size={14} className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate', u.major && 'font-semibold')}>{u.label}</span>
                {u.items && u.items.length > 1 && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {[...new Set(u.items)].map((t) => (
                      <span key={t} className="rounded bg-surface-3 px-1 text-[10px] text-sub">
                        {UPDATES[t].name}
                        {u.items!.filter((x) => x === t).length > 1 ? ` ×${u.items!.filter((x) => x === t).length}` : ''}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              {u.onTime && <Badge tone="good">on time</Badge>}
              <span className="shrink-0 text-xs text-muted">{date(u.day)}</span>
              <ScoreBadge score={u.reception} label="Reception" />
            </button>
            {open === i && u.notes && (
              <ul className="space-y-0.5 bg-surface-2 px-10 py-2 text-xs text-sub">
                {u.notes.map((n, k) => (
                  <li key={k} className="list-disc">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
