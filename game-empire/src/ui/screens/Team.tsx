import { useState } from 'react';
import { GraduationCap, RefreshCw, UserMinus, UserPlus } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { OFFICES, ROLES, TRAITS, salaryFor } from '../../engine/constants';
import { assignEmployee, fire, giveRaise, hire, paidRefresh, recruiterCost, train, trainingCost } from '../../engine/actions';
import { playerPayroll } from '../../engine/finance';
import { playerCompany } from '../../engine/util';
import type { Employee, RoleId } from '../../engine/types';
import { date, money } from '../lib/format';
import { Badge, Button, Card, Modal, Progress, SectionTitle, Stat, Td, Th, cx, inputClass } from '../components/ui';

function Traits({ traits }: { traits: Employee['traits'] }) {
  return (
    <span className="flex flex-wrap gap-1">
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
  const [firing, setFiring] = useState<Employee | null>(null);
  const emps = w.player.employees.filter((e) => roleFilter === 'all' || e.role === roleFilter);
  const projects = Object.values(w.games).filter((g) => g.companyId === c.id && (g.status === 'development' || (g.status === 'released' && g.update)));
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
                const market = e.isFounder ? 0 : salaryFor(e.role, e.skill);
                return (
                  <tr key={e.id} className="hover:bg-surface-2/50">
                    <Td>
                      <div className="font-medium">{e.name}</div>
                      <div className="text-[11px] text-muted">since {date(e.hiredDay)}</div>
                    </Td>
                    <Td className="text-sub">{e.isFounder ? `Founder · ${e.specialty}` : ROLES[e.role].name}</Td>
                    <Td>
                      <div className="flex w-24 items-center gap-2">
                        <span className="w-6 tabular">{Math.round(e.skill)}</span>
                        <Progress value={e.skill} max={100} className="flex-1" height={4} />
                      </div>
                    </Td>
                    <Td>
                      <span className={cx('tabular', e.morale < 35 ? 'text-bad' : e.morale < 60 ? 'text-warn' : 'text-good')}>{Math.round(e.morale)}%</span>
                    </Td>
                    <Td className="text-right tabular">
                      {e.isFounder ? <span className="text-muted">owner</span> : money(e.salary)}
                      {!e.isFounder && e.salary < market * 0.95 && <div className="text-[10px] text-warn">below market</div>}
                    </Td>
                    <Td>
                      {ROLES[e.role].dev ? (
                        <select
                          className={cx(inputClass, 'h-7 w-44 text-xs')}
                          value={e.assignment ?? ''}
                          onChange={(ev) => act((world) => assignEmployee(world, e.id, ev.target.value || null))}
                        >
                          <option value="">— idle —</option>
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
                      <Traits traits={e.traits} />
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title={`Training: ${money(trainingCost(w, e.id))}`} onClick={() => act((world) => train(world, e.id), `${e.name} completed training`)}>
                          <GraduationCap size={14} />
                        </Button>
                        {!e.isFounder && (
                          <>
                            <Button size="sm" variant="ghost" title="Give a 10% raise" onClick={() => act((world) => giveRaise(world, e.id), `${e.name} got a raise`)}>
                              +10%
                            </Button>
                            <Button size="sm" variant="ghost" title="Fire (1 month severance)" onClick={() => setFiring(e)}>
                              <UserMinus size={14} />
                            </Button>
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
            <div key={k.id} className="rounded-lg border border-line bg-surface-2 p-3">
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
              <div className="mt-1 text-[11px] text-muted">{ROLES[k.role].blurb}</div>
              <div className="mt-2">
                <Traits traits={k.traits} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs">
                  <span className="font-semibold tabular text-ink">{money(k.salary)}</span>
                  <span className="text-muted">/mo · fee {money(k.salary * 0.5)}</span>
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

      <Modal
        open={!!firing}
        onClose={() => setFiring(null)}
        title={`Fire ${firing?.name}?`}
        footer={
          <>
            <Button onClick={() => setFiring(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (firing) act((world) => fire(world, firing.id), `${firing.name} was let go`);
                setFiring(null);
              }}
            >
              Fire ({money(firing?.salary ?? 0)} severance)
            </Button>
          </>
        }
      >
        <p className="text-sm text-sub">Severance is one month of salary. The rest of the team will be a little shaken.</p>
      </Modal>
    </div>
  );
}
