// CEO Personalities (the C-suite) and Corporate Espionage.
import { useState } from 'react';
import { Briefcase, Eye, ShieldAlert, Star, UserPlus } from 'lucide-react';
import { useWorld } from '../../../store/gameStore';
import { execPower } from '../../../engine/dominionCore';
import { EXEC_ROLES, EXEC_ROLE_IDS, EXEC_TRAITS, fireExec, grantCost, grantStock, hireExec, mediateFeud, settleFeud, signingBonus } from '../../../engine/executives';
import { OPS, SECURITY_TIERS, auditCost, defense, launchOp, offense, opCost, opOdds, opRisk, securityAudit, securityCost, setSecurityLevel } from '../../../engine/espionage';
import { activeCorps, corpById } from '../../../engine/megacorps';
import { playerCompany } from '../../../engine/util';
import type { Executive, OpKind } from '../../../engine/types';
import { date, money, pct } from '../../lib/format';
import { Badge, Button, Card, ConfirmButton, Empty, cx, inputClass } from '../../components/ui';
import { DecisionCard } from '../../components/Overlays';
import { CorpAvatar, FeatureGate, Meter, Mini, toneText, useAct } from './shared';

const EXEC_DECISIONS = new Set(['execPoach', 'execCoup', 'execPitch', 'execMole']);
const SPY_DECISIONS = new Set(['spyLeak', 'spyMole']);

// ------------------------------------------------------------ executives

export function ExecsTab() {
  const w = useWorld();
  const d = w.player.dominion;
  const pending = w.pendingEvents.filter((e) => EXEC_DECISIONS.has(e.kind));
  const payroll = d.execs.reduce((t, e) => t + e.salary, 0);
  const nextPool = Math.max(0, 60 - (w.day - d.execPoolDay));
  return (
    <FeatureGate f="execs">
      <div className="space-y-4">
        {pending.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {pending.map((ev) => (
              <DecisionCard key={ev.id} ev={ev} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Seats filled" value={`${d.execs.length}/6`} />
          <Mini label="Payroll" value={`${money(payroll)}/mo`} />
          <Mini label="Average loyalty" value={d.execs.length ? Math.round(d.execs.reduce((t, e) => t + e.loyalty, 0) / d.execs.length) : '—'} tone={d.execs.some((e) => e.loyalty < 30) ? 'bad' : undefined} />
          <Mini label="Feuds" value={d.execs.filter((e) => e.feudWith).length / 2} tone={d.execs.some((e) => e.feudWith) ? 'warn' : undefined} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {EXEC_ROLE_IDS.map((role) => {
            const e = d.execs.find((x) => x.role === role);
            return e ? (
              <ExecCard key={role} e={e} />
            ) : (
              <div key={role} className="rounded-xl border border-dashed border-line p-4">
                <div className="text-sm font-semibold text-sub">{EXEC_ROLES[role].name}</div>
                <p className="mt-1 text-xs text-muted">{EXEC_ROLES[role].blurb}</p>
                <p className="mt-2 text-xs text-warn">Empty seat. Hire someone below.</p>
              </div>
            );
          })}
        </div>
        <Card title="Candidates" subtitle={`Headhunters bring a new shortlist every 60 days (next in ${nextPool} days). Stars from rival megacorps cost more and sometimes still report to their old boss.`}>
          {d.execPool.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {d.execPool.map((c) => (
                <Candidate key={c.id} e={c} />
              ))}
            </div>
          ) : (
            <Empty icon={<UserPlus size={20} />} title="No candidates right now">
              A new shortlist arrives at the start of next month.
            </Empty>
          )}
        </Card>
      </div>
    </FeatureGate>
  );
}

function Traits({ e }: { e: Executive }) {
  return (
    <div className="flex flex-wrap gap-1">
      {e.traits.map((t) => (
        <Badge key={t} tone={t === 'schemer' || t === 'ruthless' ? 'warn' : t === 'loyalist' ? 'good' : 'neutral'} title={EXEC_TRAITS[t].blurb}>
          {EXEC_TRAITS[t].name}
        </Badge>
      ))}
    </div>
  );
}

function ExecCard({ e }: { e: Executive }) {
  const w = useWorld();
  const act = useAct();
  const d = w.player.dominion;
  const rival = e.feudWith ? d.execs.find((x) => x.id === e.feudWith) : null;
  const cost = grantCost(e);
  const from = e.fromCorp ? corpById(w, e.fromCorp) : null;
  return (
    <div className={cx('rounded-xl border bg-surface p-4', e.loyalty < 30 ? 'border-bad/50' : rival ? 'border-warn/50' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{EXEC_ROLES[e.role].short}</div>
          <div className="truncate font-semibold">{e.name}</div>
          <div className="text-xs text-muted">
            Since {date(e.hired)} · {money(e.salary)}/mo{from ? ` · ex-${from.name}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular">{e.skill}</div>
          <div className="text-[10px] text-muted">skill</div>
        </div>
      </div>
      <div className="mt-2">
        <Traits e={e} />
      </div>
      <div className="mt-3 space-y-2">
        <Meter label="Loyalty" value={e.loyalty} tone={e.loyalty < 30 ? 'bad' : e.loyalty < 50 ? 'warn' : 'good'} />
        <Meter label="Ambition" value={e.ambition} tone={e.ambition > 75 ? 'warn' : 'neutral'} />
        <Meter label="Effect on the company" value={execPower(w, e.role) * 100} right={pct(execPower(w, e.role))} />
      </div>
      {e.loyalty < 30 && <p className="mt-2 text-[11px] text-bad">Unhappy: rivals will try to poach them, and ambitious ones plot.</p>}
      {rival && (
        <div className="mt-3 rounded-lg bg-warn-soft/40 p-2 text-xs">
          <div className="text-warn">Feuding with {rival.name} ({EXEC_ROLES[rival.role].short}). Both work worse until it ends.</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => act((world) => mediateFeud(world, e.id))}>
              Mediate
            </Button>
            <Button size="sm" onClick={() => act((world) => settleFeud(world, e.id), `You back ${e.name}`)}>
              Back {e.name.split(' ')[0]}
            </Button>
            <Button size="sm" onClick={() => act((world) => settleFeud(world, rival.id), `You back ${rival.name}`)}>
              Back {rival.name.split(' ')[0]}
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line-soft pt-3">
        <Button size="sm" variant="good" disabled={playerCompany(w).cash < cost} onClick={() => act((world) => grantStock(world, e.id), `${e.name} feels appreciated`)} title="Each grant raises loyalty a little less">
          Stock grant · {money(cost)}
        </Button>
        <ConfirmButton onConfirm={() => act((world) => fireExec(world, e.id), `${e.name} is gone`)} confirmLabel={`Fire? ${money(e.salary * 6)} severance`}>
          Fire
        </ConfirmButton>
      </div>
    </div>
  );
}

function Candidate({ e }: { e: Executive }) {
  const w = useWorld();
  const act = useAct();
  const bonus = signingBonus(e);
  const current = w.player.dominion.execs.find((x) => x.role === e.role);
  const from = e.fromCorp ? corpById(w, e.fromCorp) : null;
  return (
    <div className={cx('rounded-lg border bg-surface-2 p-3', from ? 'border-warn/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            {from && <Star size={13} className="text-warn" />} {e.name}
          </div>
          <div className="text-xs text-muted">
            {EXEC_ROLES[e.role].name}
            {from ? ` · from ${from.name}` : ''}
          </div>
        </div>
        <div className="text-right text-sm font-semibold tabular">
          {e.skill}
          {current && <span className={cx('ml-1 text-[11px] font-normal', e.skill > current.skill ? 'text-good' : 'text-bad')}>vs {current.skill}</span>}
        </div>
      </div>
      <div className="mt-1.5">
        <Traits e={e} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">
          {money(e.salary)}/mo · ambition {e.ambition}
        </span>
        <Button size="sm" variant="primary" disabled={playerCompany(w).cash < bonus} onClick={() => act((world) => hireExec(world, e.id), `${e.name} joins as ${EXEC_ROLES[e.role].short}`)} title={current ? `Replaces ${current.name} (6 months' severance)` : undefined}>
          {current ? 'Replace' : 'Hire'} · {money(bonus)}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ espionage

export function SpyTab() {
  const w = useWorld();
  const act = useAct();
  const d = w.player.dominion;
  const spy = d.spy;
  const corps = activeCorps(w).sort((a, b) => b.valuation - a.valuation);
  const [target, setTarget] = useState<string>(corps[0]?.id ?? '');
  const pending = w.pendingEvents.filter((e) => SPY_DECISIONS.has(e.kind));
  const known = spy.threats.filter((t) => t.detected);
  const auditCd = Math.max(0, 60 - (w.day - spy.auditDay));
  const cash = playerCompany(w).cash;
  const tgt = corpById(w, target) ?? corps[0];
  return (
    <FeatureGate f="espionage">
      <div className="space-y-4">
        {pending.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {pending.map((ev) => (
              <DecisionCard key={ev.id} ev={ev} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Defence" value={Math.round(defense(w))} />
          <Mini label="Your spies" value={Math.round(offense(w))} />
          <Mini label="Operations" value={`${spy.stats.opsWon} won · ${spy.stats.opsFailed} failed`} />
          <Mini label="Exposed / moles caught" value={`${spy.stats.opsExposed} / ${spy.stats.caught}`} tone={spy.stats.opsExposed ? 'warn' : undefined} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card
            title={
              <span className="flex items-center gap-1.5">
                <ShieldAlert size={14} /> Security
              </span>
            }
            subtitle="Better security stops leaks, poaching, cyberattacks and moles. Upgrading costs three months up front."
            actions={
              <Button size="sm" disabled={auditCd > 0 || cash < auditCost(w)} onClick={() => act((world) => securityAudit(world))} title="Sweep the company for moles">
                Audit {auditCd > 0 ? `(${auditCd}d)` : `· ${money(auditCost(w))}`}
              </Button>
            }
          >
            <div className="space-y-1.5">
              {SECURITY_TIERS.map((t, i) => (
                <button
                  key={t.name}
                  onClick={() => i !== spy.level && act((world) => setSecurityLevel(world, i), `Security: ${t.name}`)}
                  className={cx('flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left', i === spy.level ? 'border-accent bg-accent-soft/30' : 'border-line bg-surface-2 hover:border-sub')}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">{t.name}</div>
                    <div className="text-[11px] text-muted">{t.blurb}</div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] tabular text-sub">
                    {t.rate ? `${money(securityCost(w, i))}/mo` : 'free'}
                    <div className="text-muted">defence {t.defense}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <Card title="Threats you know about" subtitle={execPower(w, 'cso') > 0 ? 'Your CSO hunts insiders every month. Audits find the rest.' : 'Without a CSO, insiders only turn up in audits.'}>
              {known.length ? (
                <ul className="space-y-1.5 text-xs">
                  {known.map((t) => (
                    <li key={t.id} className="flex justify-between gap-2">
                      <span className="text-bad">
                        {t.kind === 'insider' ? 'Mole' : t.kind} from {corpById(w, t.corpId)?.name ?? 'a rival'}
                      </span>
                      <span className="text-muted">{date(t.day)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-sub">Nothing confirmed. That doesn’t mean nothing is there.</p>
              )}
            </Card>
            <Card title="Intel" subtitle="Intel improves your odds and reveals rivals' cash and keynote plans. It fades unless a mole keeps it fresh.">
              <div className="space-y-2">
                {corps.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-xs" style={{ color: c.color }}>
                      {c.name}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Meter label={spy.plants.includes(c.id) ? 'mole inside' : `security ${Math.round(c.security)}`} value={spy.intel[c.id] ?? 0} />
                    </div>
                  </div>
                ))}
                {!corps.length && <p className="text-sm text-sub">No megacorps to spy on yet.</p>}
              </div>
            </Card>
          </div>
        </div>

        <Card
          title={
            <span className="flex items-center gap-1.5">
              <Eye size={14} /> Operations
            </span>
          }
          subtitle={`Up to 3 at once. ${spy.ops.length} running.`}
        >
          {spy.ops.length > 0 && (
            <div className="mb-3 space-y-2">
              {spy.ops.map((op) => {
                const c = corpById(w, op.target);
                const done = Math.min(1, (w.day - op.start) / op.days);
                return (
                  <div key={op.id} className="rounded-lg bg-surface-2 px-3 py-2">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="font-medium">
                        {OPS[op.kind].name} · <span style={{ color: c?.color }}>{c?.name}</span>
                      </span>
                      <span className="text-muted tabular">
                        {pct(op.odds)} odds · {pct(op.risk)} risk · {op.days - (w.day - op.start)}d
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full bg-accent" style={{ width: `${done * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {tgt ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <CorpAvatar c={tgt} size={28} />
                <select aria-label="Target" className={cx(inputClass, 'h-8 w-auto text-xs')} value={tgt.id} onChange={(e) => setTarget(e.target.value)}>
                  {corps.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted">
                  Their security {Math.round(tgt.security)} · your intel {Math.round(spy.intel[tgt.id] ?? 0)}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {(Object.keys(OPS) as OpKind[]).map((k) => {
                  const cost = opCost(w, k, tgt.id);
                  const running = spy.ops.some((o) => o.target === tgt.id && o.kind === k);
                  const blocked = running || spy.ops.length >= 3 || cash < cost || (k === 'plant' && spy.plants.includes(tgt.id));
                  return (
                    <button
                      key={k}
                      disabled={blocked}
                      onClick={() => act((world) => launchOp(world, k, tgt.id), `${OPS[k].name}: underway`)}
                      className="rounded-lg border border-line bg-surface-2 p-2.5 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <div className="flex justify-between gap-2 text-xs font-semibold">
                        {OPS[k].name}
                        <span className="font-normal tabular text-muted">{money(cost)}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-muted">{OPS[k].blurb}</div>
                      <div className="mt-1 text-[11px] tabular">
                        <span className="text-good">{pct(opOdds(w, tgt.id))} success</span> · <span className="text-bad">{pct(opRisk(w, k, tgt.id))} exposure</span> · {OPS[k].days}d
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <Empty icon={<Briefcase size={20} />} title="No targets yet">
              Megacorps appear at the Megacorp level ($100B). Until then, security still keeps rival studios out.
            </Empty>
          )}
        </Card>

        {spy.log.length > 0 && (
          <Card title="Spy log">
            <ul className="max-h-56 space-y-1 overflow-y-auto pr-1 text-xs">
              {spy.log.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-muted tabular">{date(l.day)}</span>
                  <span className={toneText(l.tone)}>{l.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </FeatureGate>
  );
}
