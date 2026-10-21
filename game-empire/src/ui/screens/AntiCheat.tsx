// The anti-cheat operation: threats, detection layers, ban policy,
// operations against cheat makers, the security team and licensing.
import { useState } from 'react';
import { Eye, Gavel, Radar, ShieldAlert, ShieldCheck, Users, X } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { ROLES } from '../../engine/constants';
import { VENTURES, ventureBlocker } from '../../engine/ventures';
import {
  AC_LAYERS,
  AC_LAYER_IDS,
  AC_MAX_LEVEL,
  AC_MAX_OPS,
  AC_TEAM,
  BAN_MODES,
  BASE_CHEATERS,
  CHEAT_IDS,
  CHEAT_TYPES,
  COVERAGE,
  OPS,
  PENALTIES,
  acBuildCost,
  acBuildDays,
  acEffectiveness,
  acSpeed,
  appealsCover,
  catchRate,
  cheatEstimate,
  falsePositiveRate,
  foundAntiCheat,
  lawsuitOdds,
  layerBlocker,
  layerCost,
  layerPower,
  layerWork,
  opCost,
  pushSignatures,
  queueLayer,
  securityTeam,
  setAcPolicy,
  setAntiCheat,
  signatureCost,
  startAcOp,
  toggleLayer,
  unqueueLayer,
  weeklyBanEstimate,
} from '../../engine/anticheat';
import { assignEmployee } from '../../engine/actions';
import { playerCompany } from '../../engine/util';
import type { AcLayerId, BanMode, BanPenalty, CheatType } from '../../engine/types';
import { date, money, num, pct } from '../lib/format';
import { TimeChart } from '../components/charts';
import { Badge, Button, Card, Progress, Stat, cx, inputClass } from '../components/ui';

function rateTone(r: number): string {
  return r >= 0.6 ? 'bg-good' : r >= 0.35 ? 'bg-warn' : 'bg-bad';
}

export function AntiCheatTab({ locked }: { locked: React.ReactNode }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const [name, setName] = useState(`${playerCompany(w).name.split(' ')[0]} Shield`);
  const ac = w.player.ventures.antiCheat;
  if (!ac) {
    if (ventureBlocker(w, 'antiCheat')) return <>{locked}</>;
    return (
      <Card title="Build your own anti-cheat" subtitle={VENTURES.antiCheat.blurb}>
        <p className="mb-3 text-sm text-sub">
          You'll run a whole security operation: seven detection layers against six kinds of cheats, your own ban policy, a security team, and operations against cheat makers. You start with signature scanning; behaviour analysis is queued next.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <input aria-label="Anti-cheat name" className={cx(inputClass, 'w-56')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" onClick={() => act((world) => foundAntiCheat(world, name), `${name} is in development`)}>
            <ShieldCheck size={14} /> Start · {money(acBuildCost(1))} · {acBuildDays(1)} days
          </Button>
        </div>
      </Card>
    );
  }
  const eff = acEffectiveness(w);
  const est = weeklyBanEstimate(w);
  const history = ac.history ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Version" value={ac.version ? `${ac.name} v${ac.version}` : 'In development'} />
        <Stat label="Catches cheaters" value={pct(eff)} tone={eff >= 0.6 ? 'good' : eff >= 0.35 ? 'warn' : 'bad'} />
        <Stat label="Cheaters in your games" value={pct(ac.cheaters, 1)} tone={ac.cheaters <= BASE_CHEATERS * 0.6 ? 'good' : ac.cheaters > BASE_CHEATERS * 1.3 ? 'bad' : 'warn'} sub={`${num(est.cheaters)} players · industry ${pct(BASE_CHEATERS)}`} />
        <Stat label="Banned (all time)" value={num(ac.stats.bans)} sub={`${num(ac.stats.falseBans)} innocent · ${ac.stats.waves} waves`} />
        <Stat label="Licensees" value={ac.licensees.length} sub={`${money(ac.revenue)} earned`} />
      </div>
      {w.day < ac.breachUntil && <div className="rounded-lg border border-bad/30 bg-bad-soft/50 px-3 py-2 text-sm text-bad">Cheaters broke through. Twice as many new cheaters until {date(ac.breachUntil)}. Strengthen your layers or run operations.</div>}

      <Threats />
      <Layers />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Policy />
        <Operations />
        <SecurityTeam />
        <Card
          title="Sell it to rival studios"
          subtitle="Studios with online games license it for a share of their online revenue, and drop it if cheaters get through. Every licensee feeds your machine-learning layer with data."
          actions={
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={ac.licensing} onChange={(ev) => act((world) => setAntiCheat(world, { licensing: ev.target.checked }))} /> Licensing
            </label>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-sub">Fee</span>
            <select aria-label="Licence fee" className={cx(inputClass, 'h-8 w-44 text-xs')} value={ac.fee} onChange={(ev) => act((world) => setAntiCheat(world, { fee: Number(ev.target.value) }))}>
              {[0.01, 0.02, 0.03, 0.04, 0.05, 0.06].map((f) => (
                <option key={f} value={f}>
                  {pct(f)} of online revenue
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {ac.licensees.length ? ac.licensees.slice(0, 24).map((id) => <Badge key={id}>{w.companies[id]?.name}</Badge>) : <span className="text-xs text-muted">No licensees yet. Studios sign up month by month while your anti-cheat works well.</span>}
            {ac.licensees.length > 24 && <Badge>+{ac.licensees.length - 24} more</Badge>}
          </div>
        </Card>
      </div>
      {history.length > 1 && (
        <Card title="Cheating over time" subtitle="Share of players cheating in your online games, and how much your anti-cheat catches.">
          <TimeChart
            height={180}
            format={(n) => pct(n, 1)}
            series={[
              { key: 'c', name: 'Cheaters', color: '#e66767', data: history.map((h) => [h[0], h[1]] as [number, number]) },
              { key: 'e', name: 'Catch rate', color: '#199e70', data: history.map((h) => [h[0], h[2]] as [number, number]) },
            ]}
          />
        </Card>
      )}
      {ac.log?.length > 0 && (
        <Card title="Security log">
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-1 text-xs">
            {ac.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-muted tabular">{date(l.day)}</span>
                <span className={l.tone === 'good' ? 'text-good' : l.tone === 'bad' ? 'text-bad' : 'text-sub'}>{l.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Threats() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const ac = w.player.ventures.antiCheat!;
  const cash = playerCompany(w).cash;
  const busy = ac.ops.length >= AC_MAX_OPS;
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Radar size={14} /> Threat board
        </span>
      }
      subtitle="Cheat makers put their effort into whatever you catch most. Their skill is a rough guess unless you have inside intel."
    >
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {CHEAT_IDS.map((t) => {
          const e = cheatEstimate(w, t);
          const rate = catchRate(w, ac, t);
          const intel = (ac.intel[t] ?? 0) > w.day;
          return (
            <div key={t} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{CHEAT_TYPES[t].name}</span>
                {intel && (
                  <Badge tone="accent" title={`Inside intel until ${date(ac.intel[t]!)}`}>
                    <Eye size={10} /> intel
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-muted">
                {CHEAT_TYPES[t].blurb} {pct(CHEAT_TYPES[t].share)} of cheating.
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-muted">Their skill</span>
                <span className="tabular">{e.exact ? Math.round(e.value) : `~${e.value}`}</span>
              </div>
              <div className="mt-1 flex justify-between text-xs">
                <span className="text-muted">You catch</span>
                <span className="tabular font-semibold">{pct(rate)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className={cx('h-full rounded-full', rateTone(rate))} style={{ width: `${rate * 100}%` }} />
              </div>
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" disabled={busy || cash < opCost(w, 'undercover') || ac.ops.some((o) => o.kind === 'undercover' && o.target === t)} onClick={() => act((world) => startAcOp(world, 'undercover', t), 'Undercover buy underway')} title={OPS.undercover.blurb}>
                  <Eye size={12} /> Buy · {money(opCost(w, 'undercover'))}
                </Button>
                <Button size="sm" disabled={busy || cash < opCost(w, 'lawsuit') || ac.ops.some((o) => o.kind === 'lawsuit' && o.target === t)} onClick={() => act((world) => startAcOp(world, 'lawsuit', t), 'Lawsuit filed')} title={`${OPS.lawsuit.blurb} About ${pct(lawsuitOdds(w))} to win.`}>
                  <Gavel size={12} /> Sue · {money(opCost(w, 'lawsuit'))}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function topTargets(l: AcLayerId): string {
  return CHEAT_IDS.filter((t) => COVERAGE[l][t] >= 0.6)
    .map((t) => CHEAT_TYPES[t].name.toLowerCase())
    .join(', ');
}

function Layers() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const ac = w.player.ventures.antiCheat!;
  const pr = ac.project;
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <ShieldAlert size={14} /> Detection layers
        </span>
      }
      subtitle={`Each layer is good against different cheats; together they cover the gaps. One build at a time, paid day by day (security team speed ×${acSpeed(w).toFixed(2)}). Click to build or queue.`}
    >
      {(pr || ac.queue.length > 0) && (
        <div className="mb-3 grid gap-2 md:grid-cols-2">
          {pr && (
            <div className="rounded-lg border border-accent/40 bg-accent-soft/20 p-2.5">
              <div className="flex justify-between text-xs font-semibold">
                <span>
                  Building {AC_LAYERS[pr.layer].name} {pr.level}
                </span>
                <span className="tabular text-muted">{Math.ceil((pr.work - pr.done) / acSpeed(w))} days</span>
              </div>
              <Progress value={pr.done} max={pr.work} className="mt-1.5" />
            </div>
          )}
          {ac.queue.map((l, i) => (
            <div key={l} className="flex items-center justify-between rounded-lg border border-dashed border-line px-2.5 py-2 text-xs">
              <span>
                <span className="text-muted">#{i + 1}</span> {AC_LAYERS[l].name} {ac.layers[l].level + 1}
              </span>
              <button onClick={() => act((world) => unqueueLayer(world, l))} className="text-muted hover:text-bad" aria-label="Remove from queue">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {AC_LAYER_IDS.map((l) => {
          const L = ac.layers[l];
          const def = AC_LAYERS[l];
          const blocker = layerBlocker(w, l);
          const building = pr?.layer === l;
          const queued = ac.queue.includes(l);
          const reqMissing = def.requires && ac.layers[def.requires].level < 1;
          const pw = layerPower(w, ac, l, 'aimbot');
          return (
            <div key={l} className={cx('flex flex-col rounded-lg border p-3', building ? 'border-accent' : L.level && L.on ? 'border-line bg-surface-2' : 'border-line-soft bg-surface-2')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{def.name}</span>
                <span className="flex gap-0.5">
                  {Array.from({ length: AC_MAX_LEVEL }, (_, k) => (
                    <span key={k} className={cx('h-1.5 w-2.5 rounded-full', k < L.level ? (L.on ? 'bg-accent' : 'bg-sub') : 'bg-surface-3')} />
                  ))}
                </span>
              </div>
              <p className="mt-1 flex-1 text-[11px] leading-snug text-muted">{def.blurb}</p>
              <div className="mt-1 text-[10px] text-sub">Best against: {topTargets(l) || 'repeat offenders'}</div>
              {def.note && <div className="text-[10px] text-warn">{def.note}</div>}
              {l === 'signatures' && L.level > 0 && <div className="text-[10px] text-muted">Freshness: {pw > 0 ? `${Math.max(0, 100 - Math.round((w.day - ac.sigDay) * 1.2))}%` : 'off'}</div>}
              <div className="mt-2 flex items-center gap-1.5">
                {L.level < AC_MAX_LEVEL && (
                  <Button size="sm" className="flex-1" variant={building || queued ? 'secondary' : 'primary'} disabled={building || queued || !!reqMissing} title={blocker ?? undefined} onClick={() => act((world) => queueLayer(world, l), pr ? `${def.name} queued` : `Building ${def.name}`)}>
                    {building ? 'Building…' : queued ? 'Queued' : reqMissing ? `Needs ${AC_LAYERS[def.requires!].name}` : `${L.level ? `Level ${L.level + 1}` : 'Build'} · ${money(layerCost(l, L.level))} · ${Math.ceil(layerWork(L.level) / acSpeed(w))}d`}
                  </Button>
                )}
                {L.level > 0 && (
                  <label className="flex shrink-0 items-center gap-1 text-[11px]">
                    <input type="checkbox" checked={L.on} onChange={(ev) => act((world) => toggleLayer(world, l, ev.target.checked))} /> On
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Policy() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const ac = w.player.ventures.antiCheat!;
  const pol = ac.policy;
  const est = weeklyBanEstimate(w);
  const hwid = ac.layers.hwid.level > 0 && ac.layers.hwid.on;
  return (
    <Card title="Ban policy" subtitle="How you catch and punish cheaters is a trade-off every step of the way.">
      <div className="text-xs font-medium text-sub">When to ban</div>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
        {(Object.keys(BAN_MODES) as BanMode[]).map((m) => (
          <button key={m} onClick={() => act((world) => setAcPolicy(world, { banMode: m }))} className={cx('rounded-lg border px-2.5 py-2 text-left', pol.banMode === m ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}>
            <div className="text-xs font-semibold">{BAN_MODES[m].name}</div>
            <div className="text-[11px] leading-snug text-muted">{BAN_MODES[m].blurb}</div>
          </button>
        ))}
      </div>
      {pol.banMode !== 'instant' && <div className="mt-1 text-[11px] text-muted">Next wave {date(ac.nextWave)} · {pct(ac.pending, 1)} of players flagged and waiting</div>}
      <div className="mt-3">
        <div className="flex justify-between text-xs">
          <span className="text-sub">Detection sensitivity</span>
          <span className="tabular font-semibold">{pol.sensitivity}</span>
        </div>
        <input type="range" min={0} max={100} value={pol.sensitivity} onChange={(ev) => act((world) => setAcPolicy(world, { sensitivity: Number(ev.target.value) }))} className="w-full" />
        <div className="flex justify-between text-[11px] text-muted">
          <span>Catches {pct(acEffectiveness(w))} of cheaters</span>
          <span className={falsePositiveRate(ac) > 0.01 ? 'text-warn' : ''}>
            {pct(falsePositiveRate(ac), 1)} of bans hit innocent players (~{num(est.falseBans)}/week)
          </span>
        </div>
      </div>
      <div className="mt-3 text-xs font-medium text-sub">Penalty</div>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
        {(Object.keys(PENALTIES) as BanPenalty[]).map((m) => (
          <button key={m} disabled={m === 'hardware' && !hwid} onClick={() => act((world) => setAcPolicy(world, { penalty: m }))} className={cx('rounded-lg border px-2.5 py-2 text-left disabled:opacity-40', pol.penalty === m ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}>
            <div className="text-xs font-semibold">{PENALTIES[m].name}</div>
            <div className="text-[11px] leading-snug text-muted">{PENALTIES[m].blurb}</div>
          </button>
        ))}
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs">
          <span className="text-sub">Appeals team</span>
          <span className="tabular font-semibold">
            {money(pol.appeals)}/mo · undoes {pct(0.7 * appealsCover(ac, est.players))} of false-ban damage
          </span>
        </div>
        <input type="range" min={0} max={100} value={Math.round(Math.sqrt(pol.appeals / 2e6) * 100)} onChange={(ev) => act((world) => setAcPolicy(world, { appeals: Math.round((Math.pow(Number(ev.target.value) / 100, 2) * 2e6) / 1000) * 1000 }))} className="w-full" />
      </div>
    </Card>
  );
}

function Operations() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const ac = w.player.ventures.antiCheat!;
  const cash = playerCompany(w).cash;
  const sigAge = w.day - ac.sigDay;
  return (
    <Card title="Operations" subtitle={`Take the fight to the cheat makers. Up to ${AC_MAX_OPS} operations at once.`}>
      {ac.ops.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {ac.ops.map((o) => (
            <div key={o.id} className="rounded-lg bg-surface-2 px-2.5 py-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium">
                  {OPS[o.kind].name}
                  {o.target ? ` · ${CHEAT_TYPES[o.target as CheatType].name}` : ''}
                </span>
                <span className="text-muted">{o.days - (w.day - o.start)}d</span>
              </div>
              <Progress value={w.day - o.start} max={o.days} className="mt-1" height={4} />
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold">{OPS.honeypot.name}</div>
            <div className="text-[11px] text-muted">{OPS.honeypot.blurb} ML data {Math.round(ac.data)}/100.</div>
          </div>
          <Button size="sm" disabled={ac.ops.length >= AC_MAX_OPS || cash < opCost(w, 'honeypot') || ac.ops.some((o) => o.kind === 'honeypot')} onClick={() => act((world) => startAcOp(world, 'honeypot', null), 'Honeypot servers are up')}>
            Run · {money(opCost(w, 'honeypot'))}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold">Signature updates</div>
            <div className="text-[11px] text-muted">{ac.layers.signatures.level ? `Last push ${sigAge} day${sigAge === 1 ? '' : 's'} ago. Signatures go stale in about two months.` : 'Build signature scanning first.'}</div>
            <label className="mt-1 flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={ac.autoSig} disabled={!ac.layers.signatures.level} onChange={(ev) => act((world) => setAntiCheat(world, { autoSig: ev.target.checked }))} /> Push weekly automatically ({money(signatureCost(ac) * 4)}/mo)
            </label>
          </div>
          <Button size="sm" disabled={!ac.layers.signatures.level || cash < signatureCost(ac)} onClick={() => act((world) => pushSignatures(world), 'Fresh signatures pushed')}>
            Push now · {money(signatureCost(ac))}
          </Button>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <div className="flex justify-between text-xs">
            <span className="font-semibold">Bug bounty</span>
            <span className="tabular">{money(ac.bounty)}/mo</span>
          </div>
          <div className="text-[11px] text-muted">Pay security researchers to find exploits before cheaters do: slows exploit and duping cheats.</div>
          <input type="range" min={0} max={100} value={Math.round(Math.sqrt(ac.bounty / 2e6) * 100)} onChange={(ev) => act((world) => setAntiCheat(world, { bounty: Math.round((Math.pow(Number(ev.target.value) / 100, 2) * 2e6) / 1000) * 1000 }))} className="w-full" />
        </div>
      </div>
    </Card>
  );
}

function SecurityTeam() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const team = securityTeam(w);
  const devs = w.player.employees.filter((x) => ROLES[x.role].dev && x.assignment !== AC_TEAM);
  const [adding, setAdding] = useState('');
  return (
    <Card title={`Security team (${team.length})`} subtitle={`Programmers and QA testers count double. Builds layers ×${acSpeed(w).toFixed(2)} faster.`}>
      {team.length ? (
        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {team.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs">
              <span className="truncate">
                <span className="font-medium">{m.name}</span> <span className="text-muted">· {m.isFounder ? 'Founder' : ROLES[m.role].name} · {Math.round(m.skill)}</span>
              </span>
              <button onClick={() => act((world) => assignEmployee(world, m.id, null))} className="text-muted hover:text-bad" aria-label={`Take ${m.name} off the security team`}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-sub">Nobody on the security team: layers build at base speed.</p>
      )}
      <div className="mt-2 flex gap-1.5">
        <select aria-label="Add to security team" className={cx(inputClass, 'h-8 min-w-0 flex-1 text-xs')} value={adding} onChange={(ev) => setAdding(ev.target.value)}>
          <option value="">Add someone…</option>
          {devs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.isFounder ? 'Founder' : ROLES[d.role].name} {Math.round(d.skill)}
              {d.assignment ? ' (busy)' : ''}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!adding}
          onClick={() => {
            if (act((world) => assignEmployee(world, adding, AC_TEAM)).ok) setAdding('');
          }}
        >
          <Users size={12} /> Add
        </Button>
      </div>
    </Card>
  );
}
