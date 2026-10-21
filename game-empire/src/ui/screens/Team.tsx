import { useState, type ReactNode } from 'react';
import { BadgeDollarSign, Bot, Briefcase, GraduationCap, HandCoins, RefreshCw, UserMinus, UserPlus } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { OFFICES, ROLES, TRAITS } from '../../engine/constants';
import { assignDevs, assignEmployee, fire, giveRaise, hire, paidRefresh, recruiterCost, setAutoAssign, train, trainingCost } from '../../engine/actions';
import { playerPayroll } from '../../engine/finance';
import { playerCompany } from '../../engine/util';
import type { Employee, Game, HrSpending, RoleId } from '../../engine/types';
import { date, money } from '../lib/format';
import { Badge, Button, Card, ConfirmButton, Progress, SectionTitle, Stat, Td, Th, cx, inputClass } from '../components/ui';
import { recruitFee } from '../../engine/staff';
import { liveLevel } from '../../engine/patches';
import { ENGINE_TEAM } from '../../engine/studioEngine';
import { AC_TEAM } from '../../engine/anticheat';
import { BENEFITS, HOURS, QA_POLICIES, retainerCost } from '../../engine/constants';
import { policyMonthlyCost, setPolicies } from '../../engine/business';
import { HR_SPENDING, fixAllPay, needsRaise, payFairly, payGrade, payReview, payStatus, hireStatus, setHr, trainingFloor, trainingQueue, trainingWait } from '../../engine/hr';

function Traits({ traits, liveXp }: { traits: Employee['traits']; liveXp?: number }) {
  const lo = liveLevel({ liveXp } as Employee);
  return (
    <span className="flex flex-wrap gap-1">
      {lo > 0 && (
        <Badge tone="good" title={`Live-ops level ${lo}: +${lo * 3}% output on patches and better reception. Earned by shipping patches.`}>
          Live ops {lo}
        </Badge>
      )}
      {traits.map((t) => (
        <Badge key={t} tone={TRAITS[t].good ? 'accent' : 'bad'} title={TRAITS[t].blurb}>
          {TRAITS[t].name}
        </Badge>
      ))}
    </span>
  );
}

export function Team() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const office = OFFICES[w.player.officeLevel];
  const [roleFilter, setRoleFilter] = useState<RoleId | 'all'>('all');
  const emps = w.player.employees.filter((e) => roleFilter === 'all' || e.role === roleFilter);
  const onTeam = new Set(w.player.employees.map((e) => e.assignment));
  const projects = Object.values(w.games).filter((g) => g.companyId === c.id && (g.status === 'development' || (g.status === 'released' && (g.patchPlan?.backlog.length || g.patchPlan?.teamTarget || onTeam.has(g.id)))));
  const avgMorale = w.player.employees.reduce((s, e) => s + e.morale, 0) / Math.max(1, w.player.employees.length);
  const full = w.player.employees.length >= office.capacity;
  const nextRefresh = Math.max(0, 28 - (w.day - w.player.candidatesRefreshDay));

  return (
    <div className="space-y-4">
      <SectionTitle>Team</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Headcount" value={`${w.player.employees.length} / ${office.capacity}`} sub={office.name} tone={full ? 'warn' : undefined} />
        <Stat label="Monthly payroll" value={money(playerPayroll(w))} />
        <Stat label="Average morale" value={`${Math.round(avgMorale)}%`} tone={avgMorale < 45 ? 'bad' : avgMorale < 65 ? 'warn' : 'good'} />
        <Stat label="Idle developers" value={w.player.employees.filter((e) => ROLES[e.role].dev && !e.assignment).length} />
      </div>

      <HrAutopilot projects={projects} />

      <Policies />

      <Card
        title="Employees"
        pad={false}
        actions={
          <select className={cx(inputClass, 'h-8 w-40 text-xs')} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleId | 'all')}>
            <option value="all">All roles</option>
            {(Object.keys(ROLES) as RoleId[]).map((r) => (
              <option key={r} value={r}>
                {ROLES[r].plural}
              </option>
            ))}
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line-soft">
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Skill</Th>
                <Th>Morale</Th>
                <Th className="text-right">Salary</Th>
                <Th>Assignment</Th>
                <Th>Traits</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {emps.map((e) => {
                const pay = payStatus(e);
                return (
                  <tr key={e.id} className="hover:bg-surface-2/50">
                    <Td>
                      <div className="font-medium" title={e.bio}>{e.name}{e.traits.includes('legend') && <span className="ml-1 text-warn">★</span>}</div>
                      <div className="text-[11px] text-muted">since {date(e.hiredDay)}</div>
                    </Td>
                    <Td className="text-sub">{e.isFounder ? `Founder · ${e.specialty}` : ROLES[e.role].name}</Td>
                    <Td>
                      <div className="flex w-24 items-center gap-2">
                        <span className="w-6 tabular">{Math.round(e.skill)}</span>
                        <Progress value={e.skill} max={100} className="flex-1" height={4} />
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted">
                        {payGrade(e.skill)}
                        {e.trainedDay !== undefined && w.day - e.trainedDay < 30 && <span className="ml-1 normal-case tracking-normal text-good">▲ +{Math.max(1, Math.round(e.trainedGain ?? 1))} trained</span>}
                      </div>
                    </Td>
                    <Td>
                      <span className={cx('tabular', e.morale < 35 ? 'text-bad' : e.morale < 60 ? 'text-warn' : 'text-good')}>{Math.round(e.morale)}%</span>
                    </Td>
                    <Td className="text-right tabular">
                      {e.isFounder ? <span className="text-muted">owner</span> : money(e.salary)}
                      {!e.isFounder && <div className={cx('text-[10px]', pay.tone === 'bad' ? 'text-bad' : pay.tone === 'warn' ? 'text-warn' : pay.tone === 'good' ? 'text-good' : 'text-muted')}>{pay.label}</div>}
                    </Td>
                    <Td>
                      {ROLES[e.role].dev ? (
                        <select
                          className={cx(inputClass, 'h-7 w-44 text-xs')}
                          value={e.assignment ?? ''}
                          onChange={(ev) => act((world) => assignEmployee(world, e.id, ev.target.value || null))}
                        >
                          <option value="">— idle —</option>
                          {w.player.engine && <option value={ENGINE_TEAM}>Engine team: {w.player.engine.name}</option>}
                          {w.player.ventures.antiCheat && <option value={AC_TEAM}>Security team: {w.player.ventures.antiCheat.name}</option>}
                          {projects.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title} {g.status === 'released' ? '(update)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-muted">company-wide</span>
                      )}
                    </Td>
                    <Td>
                      <Traits traits={e.traits} liveXp={e.liveXp} />
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title={`Training: ${money(trainingCost(w, e.id))}`} onClick={() => act((world) => train(world, e.id), `${e.name} completed training`)}>
                          <GraduationCap size={14} />
                        </Button>
                        {!e.isFounder && (
                          <>
                            {needsRaise(e) && (
                              <Button size="sm" variant="ghost" title={`Raise to ${payGrade(e.skill).toLowerCase()} pay`} onClick={() => act((world) => payFairly(world, e.id), `${e.name} is now paid fairly`)}>
                                <BadgeDollarSign size={14} className="text-warn" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" title="Give a 10% raise" onClick={() => act((world) => giveRaise(world, e.id), `${e.name} got a raise`)}>
                              +10%
                            </Button>
                            <ConfirmButton variant="ghost" title="Fire (1 month severance)" confirmLabel={`Fire? ${money(e.salary)}`} onConfirm={() => act((world) => fire(world, e.id), `${e.name} was let go`)}>
                              <UserMinus size={14} />
                            </ConfirmButton>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Hiring"
        subtitle={`New candidates every 4 weeks (next in ${nextRefresh} days). Better reputation attracts better people.${w.day < w.market.talentSurgeUntil ? ' A studio collapse has flooded the market with talent!' : ''}`}
        actions={
          <Button size="sm" onClick={() => act((world) => paidRefresh(world), 'New candidates found')}>
            <RefreshCw size={13} /> Headhunter ({money(recruiterCost(w))})
          </Button>
        }
      >
        {full && <div className="mb-3 rounded-lg border border-warn/30 bg-warn-soft/60 px-3 py-2 text-sm text-warn">Your {office.name} is full. Move to a bigger office to hire more.</div>}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {w.player.candidates.map((k) => (
            <div key={k.id} className={cx('rounded-lg border p-3', k.traits.includes('legend') ? 'border-warn/50 bg-warn-soft/20 shadow-[0_0_0_1px_rgba(224,165,38,0.15)]' : 'border-line bg-surface-2')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{k.name}</div>
                  <div className="text-xs text-muted">
                    {ROLES[k.role].name}
                    {k.formerStudio && <span className="text-accent"> · ex-{k.formerStudio}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold tabular">{k.skill}</div>
                  <div className="text-[10px] uppercase text-muted">skill</div>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-muted">{k.bio ? <span className="italic text-sub">"{k.bio}"</span> : ROLES[k.role].blurb}</div>
              <div className="mt-2">
                <Traits traits={k.traits} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs">
                  <span className="font-semibold tabular text-ink">{money(k.salary)}</span>
                  <span className="text-muted">/mo · fee {money(recruitFee(w, k.salary))}</span>
                </div>
                <Button size="sm" variant="primary" disabled={full} onClick={() => act((world) => hire(world, k.id), `Hired ${k.name}`)}>
                  <UserPlus size={13} /> Hire
                </Button>
              </div>
            </div>
          ))}
          {w.player.candidates.length === 0 && <div className="text-sm text-muted">No candidates right now — check back soon or use a headhunter.</div>}
        </div>
      </Card>

    </div>
  );
}

function AutoToggle({ id, on, onChange, icon, title, detail, status, children }: { id: string; on: boolean; onChange: (v: boolean) => void; icon: ReactNode; title: string; detail: string; status: ReactNode; children?: ReactNode }) {
  return (
    <div className={cx('rounded-lg border px-3 py-2.5 transition-colors', on ? 'border-accent/60 bg-accent-soft/30' : 'border-line bg-surface-2 hover:border-sub')}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input id={id} type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {icon}
            {title}
          </span>
          <span className="block text-xs text-muted">{detail}</span>
          <span className="mt-1 block text-[11px] text-sub">{status}</span>
        </span>
      </label>
      {children && <div className="mt-2 pl-7">{children}</div>}
    </div>
  );
}

const TEAM_TARGETS = [0, 3, 5, 10, 15, 25, 50, 100, 250, 500];

function HrAutopilot({ projects }: { projects: Game[] }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const [bulkTarget, setBulkTarget] = useState('');
  const hr = w.player.hr;
  const style = HR_SPENDING[hr.spending];
  const review = payReview(w);
  const floor = trainingFloor(w);
  const next = trainingQueue(w)[0];
  const trainWait = next ? trainingWait(w, next.cost) : null;
  const hiring = hireStatus(w);
  const idle = w.player.employees.filter((e) => ROLES[e.role].dev && !e.assignment).length;
  const trainedLately = w.player.employees.filter((e) => e.trainedDay !== undefined && w.day - e.trainedDay < 90).length;
  const onCount = [hr.autoHire, hr.autoTrain, hr.autoRaise, w.player.autoAssign].filter(Boolean).length;
  const set = (patch: Parameters<typeof setHr>[1]) => act((world) => setHr(world, patch));
  const toneText = (t: 'good' | 'warn' | 'neutral') => (t === 'good' ? 'text-good' : t === 'warn' ? 'text-warn' : undefined);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Bot size={16} className="text-accent" /> HR autopilot
        </span>
      }
      subtitle="Let HR run your people: hire to fill empty desks, train everyone's skill up, keep pay in line with skill so nobody quits, and give everyone a job."
      actions={<Badge tone={onCount === 4 ? 'good' : onCount > 0 ? 'accent' : 'neutral'}>{onCount}/4 on</Badge>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <AutoToggle
              id="hr-auto-hire"
              on={hr.autoHire}
              onChange={(v) => set({ autoHire: v })}
              icon={<UserPlus size={14} />}
              title="Auto hiring"
              detail="Every week HR hires the best candidates it can afford for the roles you're short on, and replaces anyone who quits."
              status={<span className={toneText(hiring.tone)}>{hiring.text}</span>}
            >
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="hr-team-target" className="text-[11px] text-muted">
                  Grow team to
                </label>
                <select id="hr-team-target" className={cx(inputClass, 'h-7 w-32 text-xs')} value={hr.teamTarget} onChange={(e) => set({ teamTarget: Number(e.target.value) })}>
                  {TEAM_TARGETS.map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'Fill the office' : `${n} people`}
                    </option>
                  ))}
                </select>
                {hiring.office && (
                  <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'office' })}>
                    Bigger office →
                  </Button>
                )}
              </div>
            </AutoToggle>
            <AutoToggle
              id="hr-auto-train"
              on={hr.autoTrain}
              onChange={(v) => set({ autoTrain: v })}
              icon={<GraduationCap size={14} />}
              title="Auto skill upgrades"
              detail="Every month HR sends your least skilled developers on training, so their skill goes up. Each person trains once every 3 months."
              status={
                !hr.autoTrain || !next ? (
                  `${trainedLately} trained in the last 3 months${next ? '' : ' · nobody due yet'}`
                ) : trainWait === 'cash' ? (
                  <span className="text-warn">
                    Waiting for cash: {next.e.isFounder ? 'your' : `${next.e.name.split(' ')[0]}'s`} training costs {money(next.cost)} and {style.name.toLowerCase()} HR keeps {money(floor)} in the bank
                  </span>
                ) : trainWait === 'income' ? (
                  <span className="text-warn">
                    Waiting for income: {next.e.isFounder ? 'your' : `${next.e.name.split(' ')[0]}'s`} training costs {money(next.cost)}. HR starts training once your games earn more than the studio spends (Generous HR trains sooner).
                  </span>
                ) : (
                  <span className="text-good">
                    {trainedLately} trained in the last 3 months · next: {next.e.isFounder ? 'you' : next.e.name.split(' ')[0]} ({money(next.cost)})
                  </span>
                )
              }
            />
            <AutoToggle
              id="hr-auto-raise"
              on={hr.autoRaise}
              onChange={(v) => set({ autoRaise: v })}
              icon={<BadgeDollarSign size={14} />}
              title="Auto raises"
              detail="Every month, anyone who has grown past their pay grade, or is unhappy and underpaid, gets a raise."
              status={
                review.underpaid.length ? (
                  <span className="text-warn">
                    {review.underpaid.length} below their pay grade (+{money(review.cost)}/mo to fix)
                  </span>
                ) : (
                  <span className="text-good">Everyone is paid fairly</span>
                )
              }
            />
            <AutoToggle
              id="auto-assign"
              on={w.player.autoAssign}
              onChange={(v) => act((world) => setAutoAssign(world, v))}
              icon={<Briefcase size={14} />}
              title="Auto jobs"
              detail="Idle developers join the game that needs people most, a running update or a contract that is behind."
              status={idle > 0 ? `${idle} idle right now` : 'Everyone has work'}
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-sub">HR spending</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(HR_SPENDING) as HrSpending[]).map((id) => (
                <button
                  key={id}
                  onClick={() => set({ spending: id })}
                  className={cx('rounded-lg border px-2.5 py-2 text-left transition-colors', hr.spending === id ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}
                >
                  <div className="text-xs font-semibold">{HR_SPENDING[id].name}</div>
                  <div className="text-[11px] text-muted">{HR_SPENDING[id].blurb}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Pay check</div>
                <div className="text-xs text-muted">
                  {review.underpaid.length ? `${review.underpaid.length} ${review.underpaid.length > 1 ? 'people are' : 'person is'} paid below their grade. Underpaid people lose morale and leave.` : `Pay matches skill. ${style.name} HR pays ${Math.round(style.payTarget * 100)}% of market.`}
                </div>
              </div>
              <Button size="sm" variant={review.underpaid.length ? 'primary' : 'ghost'} disabled={!review.underpaid.length} onClick={() => act((world) => fixAllPay(world), 'Everyone is paid fairly now')}>
                <HandCoins size={13} /> Fix all pay
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-sub">Recent HR activity</div>
            {hr.log.length ? (
              <ul className="space-y-1 text-xs">
                {hr.log.slice(0, 5).map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 tabular text-muted">{date(l.day)}</span>
                    <span className="text-sub">{l.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted">Nothing yet. HR checks in at the start of every month.</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
            <select id="bulk-target" className={cx(inputClass, 'h-8 min-w-0 flex-1 text-xs')} value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>
              <option value="">Move developers to…</option>
              {projects.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} {g.status === 'released' ? '(update)' : ''}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!bulkTarget} onClick={() => act((world) => assignDevs(world, bulkTarget, 'idle'), 'Idle developers moved')}>
              All idle
            </Button>
            <Button size="sm" disabled={!bulkTarget} onClick={() => act((world) => assignDevs(world, bulkTarget, 'everyone'), 'Everyone moved')}>
              Everyone
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PolicyChoice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string; detail: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-sub">{label}</div>
      <div className="grid gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cx('rounded-lg border px-3 py-2 text-left transition-colors', value === o.id ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}
          >
            <div className="text-xs font-semibold">{o.name}</div>
            <div className="text-[11px] text-muted">{o.detail}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Policies() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const pol = w.player.policies;
  const heads = w.player.employees.length;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return (
    <Card title="Company policies" subtitle={`How you treat your people shapes speed, quality and who stays. Policies cost ${money(policyMonthlyCost(w))}/mo right now.`}>
      <div className="grid gap-4 md:grid-cols-3">
        <PolicyChoice
          label="Benefits"
          value={pol.benefits}
          onChange={(v) => act((world) => setPolicies(world, { benefits: v }))}
          options={(Object.keys(BENEFITS) as (keyof typeof BENEFITS)[]).map((id) => ({
            id,
            name: `${BENEFITS[id].name}${BENEFITS[id].perHead ? ` · ${money(BENEFITS[id].perHead * heads)}/mo` : ''}`,
            detail: `${BENEFITS[id].blurb}${BENEFITS[id].morale ? ` Morale ${sign(BENEFITS[id].morale)}.` : ''}`,
          }))}
        />
        <PolicyChoice
          label="Working hours"
          value={pol.hours}
          onChange={(v) => act((world) => setPolicies(world, { hours: v }))}
          options={(Object.keys(HOURS) as (keyof typeof HOURS)[]).map((id) => ({
            id,
            name: HOURS[id].name,
            detail: `${HOURS[id].blurb} Speed ×${HOURS[id].speed.toFixed(2)}${HOURS[id].morale ? `, morale ${sign(HOURS[id].morale)}` : ''}.`,
          }))}
        />
        <PolicyChoice
          label="Quality assurance"
          value={pol.qa}
          onChange={(v) => act((world) => setPolicies(world, { qa: v }))}
          options={(Object.keys(QA_POLICIES) as (keyof typeof QA_POLICIES)[]).map((id) => ({
            id,
            name: QA_POLICIES[id].name,
            detail: `${QA_POLICIES[id].blurb} Bugs ×${QA_POLICIES[id].bugs.toFixed(2)}, speed ×${QA_POLICIES[id].speed.toFixed(2)}.`,
          }))}
        />
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <input type="checkbox" className="mt-1" checked={pol.profitSharing} onChange={(e) => act((world) => setPolicies(world, { profitSharing: e.target.checked }))} />
          <span>
            <span className="block text-sm font-medium">Profit sharing</span>
            <span className="block text-xs text-muted">5% of every profitable month goes to the team. Morale +8 each payout.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <input type="checkbox" className="mt-1" checked={pol.retainer} onChange={(e) => act((world) => setPolicies(world, { retainer: e.target.checked }))} />
          <span>
            <span className="block text-sm font-medium">Marketing agency retainer · {money(retainerCost(heads))}/mo</span>
            <span className="block text-xs text-muted">A PR firm keeps every game in development in the news: steady hype every day.</span>
          </span>
        </label>
      </div>
    </Card>
  );
}
