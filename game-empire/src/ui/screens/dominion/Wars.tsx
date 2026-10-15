// Global Empire Wars: the megacorps, your wars, alliances and annexations.
import { useState } from 'react';
import { Handshake, Skull, Swords, Users } from 'lucide-react';
import { useWorld } from '../../../store/gameStore';
import { SECTORS, SECTOR_IDS, featureOpen } from '../../../engine/dominionCore';
import {
  TACTICS,
  activeCorps,
  allianceBonus,
  allianceChance,
  allianceOf,
  corpById,
  corpRevenue,
  declareWar,
  joinWar,
  jointVenture,
  jointVentureCost,
  leaveAlliance,
  makePeace,
  mergerBlocker,
  mergerPrice,
  partyName,
  peaceTerms,
  playerScore,
  proposeAlliance,
  proposeMerger,
  setWarIntensity,
  sideForce,
  sideOf,
  tacticCost,
  useTactic,
  warDailyCost,
  warEta,
  warsOf,
} from '../../../engine/megacorps';
import { CORP_PERSONAS } from '../../../engine/corpLines';
import { playerCompany } from '../../../engine/util';
import type { Megacorp, SectorId, War, WarTactic } from '../../../engine/types';
import { date, money, pct } from '../../lib/format';
import { Badge, Button, Card, ConfirmButton, Empty, cx, inputClass } from '../../components/ui';
import { Sparkline } from '../../components/charts';
import { DecisionCard } from '../../components/Overlays';
import { CenterBar, CorpAvatar, FeatureGate, Mini, relationLabel, useAct } from './shared';

const INTENSITY = ['Holding', 'Steady', 'Aggressive', 'All-in'];
const DECISIONS = new Set(['warCall', 'peaceOffer', 'annex', 'allianceOffer']);

export function WarsTab() {
  const w = useWorld();
  const act = useAct();
  const d = w.player.dominion;
  const corps = activeCorps(w).sort((a, b) => b.valuation - a.valuation);
  const mine = warsOf(w, 'player');
  const others = d.wars.filter((x) => !sideOf(x, 'player'));
  const al = allianceOf(w, 'player');
  const pending = w.pendingEvents.filter((e) => DECISIONS.has(e.kind));
  return (
    <FeatureGate f="wars">
      <div className="space-y-4">
        {pending.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {pending.map((ev) => (
              <DecisionCard key={ev.id} ev={ev} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Megacorps" value={corps.length} />
          <Mini label="Your wars" value={`${mine.length}/3`} tone={mine.length ? 'bad' : undefined} />
          <Mini label="Record" value={`${d.stats.warsWon} won · ${d.stats.warsLost} lost`} />
          <Mini label="Absorbed corps" value={d.annexed.length ? `${d.annexed.length} · ${money(annexedMonthly(w))}/mo` : '0'} tone={d.annexed.length ? 'good' : undefined} />
        </div>

        {mine.map((war) => (
          <WarCard key={war.id} war={war} />
        ))}

        {al && (
          <Card
            title={
              <span className="flex items-center gap-1.5">
                <Handshake size={14} className="text-good" /> {al.name}
              </span>
            }
            subtitle={`Allies defend each other and share technology: +${pct(allianceBonus(w))} income. Formed ${date(al.formed)}.`}
            actions={
              <ConfirmButton onConfirm={() => act((world) => leaveAlliance(world), 'You left the alliance')} confirmLabel="Leave? Click again">
                Leave
              </ConfirmButton>
            }
          >
            <div className="flex flex-wrap gap-2">
              {al.members.map((m) => (
                <Badge key={m} tone={m === 'player' ? 'accent' : 'good'}>
                  {partyName(w, m)}
                </Badge>
              ))}
            </div>
          </Card>
        )}

        <div>
          <h2 className="mb-2 text-sm font-semibold text-sub">The megacorporations</h2>
          {corps.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {corps.map((c) => (
                <CorpCard key={c.id} c={c} />
              ))}
            </div>
          ) : (
            <Empty icon={<Users size={22} />} title="No megacorps yet">
              They appear once you reach the Megacorp level.
            </Empty>
          )}
        </div>

        {others.length > 0 && (
          <Card title="Wars between megacorps" subtitle="Pick a side: the winners remember their friends, the losers their enemies.">
            <div className="space-y-3">
              {others.map((war) => (
                <ForeignWar key={war.id} war={war} />
              ))}
            </div>
          </Card>
        )}

        {(d.alliances.filter((a) => !a.members.includes('player')).length > 0 || d.warHistory.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card title="Alliances" subtitle="Blocs that fight together.">
              {d.alliances.length ? (
                <ul className="space-y-2 text-sm">
                  {d.alliances.map((a) => (
                    <li key={a.id}>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted">{a.members.map((m) => partyName(w, m)).join(' · ')}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-sub">No alliances right now.</p>
              )}
            </Card>
            <Card title="War history">
              {d.warHistory.length ? (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-xs">
                  {d.warHistory.map((h) => (
                    <li key={h.id} className="flex justify-between gap-2">
                      <span className="text-sub">
                        {SECTORS[h.sector].emoji} {h.title}: {h.result}
                      </span>
                      {h.player && <span className={cx('shrink-0 font-medium', h.player === 'won' ? 'text-good' : h.player === 'lost' ? 'text-bad' : 'text-muted')}>{h.player}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-sub">No wars fought yet.</p>
              )}
            </Card>
          </div>
        )}
      </div>
    </FeatureGate>
  );
}

/** What absorbed corps pay you each month (annexedIncome() also grows them, so the UI can't call it). */
function annexedMonthly(w: ReturnType<typeof useWorld>): number {
  let t = 0;
  for (const a of w.player.dominion.annexed) for (const s of SECTOR_IDS) t += a.power[s];
  return (t / 12) * 0.5;
}

function WarCard({ war }: { war: War }) {
  const w = useWorld();
  const act = useAct();
  const side = sideOf(war, 'player')!;
  const foes = side === 'attackers' ? war.defenders : war.attackers;
  const friends = (side === 'attackers' ? war.attackers : war.defenders).filter((x) => x !== 'player');
  const ps = playerScore(war);
  const eta = warEta(w, war);
  const drift = sideForce(w, war, 'attackers') - sideForce(w, war, 'defenders');
  const etaGood = side === 'attackers' ? drift > 0 : drift < 0;
  const terms = peaceTerms(w, war.id);
  const cash = playerCompany(w).cash;
  const intensity = war.intensity.player ?? 1;
  return (
    <Card
      className="border-bad/40"
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          <Swords size={14} className="text-bad" /> {SECTORS[war.sector].emoji} {SECTORS[war.sector].name} war
          <span className="font-normal text-muted">
            vs {foes.map((f) => partyName(w, f)).join(' & ')}
            {friends.length > 0 && <> · with {friends.map((f) => partyName(w, f)).join(' & ')}</>}
          </span>
        </span>
      }
      subtitle={`Started ${date(war.start)} · costing ${money(warDailyCost(w, war) * 30)}/mo at this intensity · ${money(war.spent.player ?? 0)} spent so far`}
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-bad">Losing</span>
            <span className={cx('font-semibold tabular', ps >= 0 ? 'text-good' : 'text-bad')}>
              {ps >= 0 ? '+' : ''}
              {Math.round(ps)}
              {eta != null && <span className="font-normal text-muted"> · {etaGood ? 'victory' : 'defeat'} in ~{eta} days at this pace</span>}
            </span>
            <span className="text-good">Winning</span>
          </div>
          <CenterBar value={ps} height={10} />
          <p className="mt-1.5 text-[11px] text-muted">At +100 you win: their market share drops, you earn +20% in {SECTORS[war.sector].name.toLowerCase()} for two years and they may sell out to you. At −100 it’s the reverse.</p>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-sub">Intensity</div>
          <div className="grid grid-cols-4 gap-1.5">
            {INTENSITY.map((label, i) => (
              <button
                key={label}
                onClick={() => act((world) => setWarIntensity(world, war.id, i))}
                className={cx('rounded-md border px-2 py-1.5 text-xs', intensity === i ? 'border-accent bg-accent-soft/40 text-ink' : 'border-line bg-surface-2 text-sub hover:border-sub')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-sub">Tactics</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(TACTICS) as WarTactic[]).map((t) => {
              const def = TACTICS[t];
              const cost = tacticCost(w, t);
              const cd = (war.cooldowns[t] ?? 0) - w.day;
              const locked = def.needs && !featureOpen(w, def.needs);
              return (
                <button
                  key={t}
                  disabled={cd > 0 || cash < cost || !!locked}
                  onClick={() => act((world) => useTactic(world, war.id, t), `${def.name}!`)}
                  className="rounded-lg border border-line bg-surface-2 p-2.5 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-45"
                  title={def.blurb}
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    {def.name}
                    <span className="font-normal tabular text-muted">{cd > 0 ? `${cd}d` : locked ? 'Espionage' : money(cost)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted">{def.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-xs text-sub">{terms.note}</span>
          <ConfirmButton variant={terms.payment >= 0 ? 'good' : 'secondary'} disabled={!terms.accept || (terms.payment < 0 && cash < -terms.payment)} onConfirm={() => act((world) => makePeace(world, war.id), 'The war is over')} confirmLabel="Sign the treaty?">
            Sue for peace
          </ConfirmButton>
        </div>

        {war.log.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto pr-1 text-xs">
            {war.log.slice(0, 12).map((l, i) => {
              const good = side === 'attackers' ? l.swing >= 0 : l.swing <= 0;
              return (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-muted tabular">{date(l.day)}</span>
                  <span className="text-sub">{l.text}</span>
                  <span className={cx('ml-auto shrink-0 tabular', good ? 'text-good' : 'text-bad')}>
                    {good ? '+' : '−'}
                    {Math.abs(l.swing).toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CorpCard({ c }: { c: Megacorp }) {
  const w = useWorld();
  const act = useAct();
  const [sector, setSector] = useState<SectorId>(topSector(c));
  const persona = CORP_PERSONAS[c.persona];
  const rel = relationLabel(c.relation);
  const intel = w.player.dominion.spy.intel[c.id] ?? 0;
  const al = allianceOf(w, c.id);
  const atWar = warsOf(w, 'player').some((x) => x.attackers.includes(c.id) || x.defenders.includes(c.id));
  const isAlly = !!al && al.members.includes('player');
  const p = playerCompany(w);
  const jvCd = 120 - (w.day - c.talksDay);
  const askCd = 90 - (w.day - (w.player.flags[`ask:${c.id}`] ?? -9999));
  const merger = mergerBlocker(w, c.id);
  const rev = corpRevenue(c);
  const sectors = [...SECTOR_IDS].filter((s) => c.power[s] > 0).sort((a, b) => c.power[b] - c.power[a]);
  return (
    <div className={cx('rounded-xl border bg-surface p-4', atWar ? 'border-bad/50' : isAlly ? 'border-good/40' : 'border-line')}>
      <div className="flex items-start gap-3">
        <CorpAvatar c={c} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold" style={{ color: c.color }}>
              {c.name}
            </span>
            <Badge tone="neutral" title={persona.blurb}>
              {persona.name}
            </Badge>
            {atWar && (
              <Badge tone="bad">
                <Skull size={10} /> At war
              </Badge>
            )}
            {isAlly && <Badge tone="good">Ally</Badge>}
            {al && !isAlly && <Badge tone="neutral">{al.name}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            CEO {c.ceo} · worth {money(c.valuation)} · {money(rev)}/yr
          </div>
        </div>
        <Sparkline data={c.history.slice(-24).map((h) => h[1])} color={c.color} width={72} height={28} />
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs">
          <span className="text-muted">How they see you</span>
          <span className={cx('font-medium', rel.tone === 'good' ? 'text-good' : rel.tone === 'bad' ? 'text-bad' : rel.tone === 'warn' ? 'text-warn' : 'text-sub')}>
            {rel.text} ({Math.round(c.relation)})
          </span>
        </div>
        <CenterBar value={c.relation} className="mt-1" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        {sectors.slice(0, 4).map((s) => (
          <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-sub">
            {SECTORS[s].emoji} {money(c.power[s])}
          </span>
        ))}
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-sub" title="Intel from espionage reveals their cash and plans">
          Intel {Math.round(intel)} {intel >= 30 ? `· cash ${money(c.cash)}` : ''}
        </span>
        {c.exhaustion > 20 && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">War-weary {Math.round(c.exhaustion)}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-soft pt-3">
        <Button size="sm" disabled={atWar || isAlly || askCd > 0} title={askCd > 0 ? `Ask again in ${askCd} days` : `About ${pct(allianceChance(w, c.id))} chance they say yes`} onClick={() => act((world) => proposeAlliance(world, c.id))}>
          <Handshake size={13} /> Ally {askCd > 0 ? `(${askCd}d)` : `· ${pct(allianceChance(w, c.id))}`}
        </Button>
        <Button size="sm" disabled={atWar || jvCd > 0 || p.cash < jointVentureCost(w)} title="Spend together on a project: relations improve" onClick={() => act((world) => jointVenture(world, c.id), `Joint venture with ${c.name}`)}>
          Joint venture {jvCd > 0 ? `(${jvCd}d)` : `· ${money(jointVentureCost(w))}`}
        </Button>
        <Button size="sm" variant="good" disabled={!!merger} title={merger ?? `Buy them for ${money(mergerPrice(w, c.id))}`} onClick={() => act((world) => proposeMerger(world, c.id))}>
          Merge · {money(mergerPrice(w, c.id))}
        </Button>
        {!atWar && !isAlly && (
          <span className="ml-auto flex items-center gap-1.5">
            <select aria-label="War sector" className={cx(inputClass, 'h-7 w-auto px-2 text-xs')} value={sector} onChange={(e) => setSector(e.target.value as SectorId)}>
              {SECTOR_IDS.map((s) => (
                <option key={s} value={s}>
                  {SECTORS[s].name}
                </option>
              ))}
            </select>
            <ConfirmButton disabled={warsOf(w, 'player').length >= 3} onConfirm={() => act((world) => declareWar(world, c.id, sector), `War declared on ${c.name}`)} confirmLabel="Declare war?">
              <Swords size={13} /> War
            </ConfirmButton>
          </span>
        )}
      </div>
      {merger && c.relation >= 40 && <p className="mt-1.5 text-[11px] text-muted">Merger: {merger}</p>}
    </div>
  );
}

function topSector(c: Megacorp): SectorId {
  let best: SectorId = 'games';
  for (const s of SECTOR_IDS) if (c.power[s] > c.power[best]) best = s;
  return best;
}

function ForeignWar({ war }: { war: War }) {
  const w = useWorld();
  const act = useAct();
  const a = corpById(w, war.attackers[0]);
  const b = corpById(w, war.defenders[0]);
  const canJoin = warsOf(w, 'player').length < 3;
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {SECTORS[war.sector].emoji} <span style={{ color: a?.color }}>{war.attackers.map((x) => partyName(w, x)).join(' & ')}</span> <span className="text-muted">vs</span>{' '}
          <span style={{ color: b?.color }}>{war.defenders.map((x) => partyName(w, x)).join(' & ')}</span>
        </span>
        <span className="text-xs text-muted">since {date(war.start)}</span>
      </div>
      <CenterBar value={war.score} className="mt-2" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" disabled={!canJoin} onClick={() => act((world) => joinWar(world, war.id, 'attackers'), `You joined ${a?.name ?? 'the attackers'}`)}>
          Back {a?.name ?? 'attackers'}
        </Button>
        <Button size="sm" disabled={!canJoin} onClick={() => act((world) => joinWar(world, war.id, 'defenders'), `You joined ${b?.name ?? 'the defenders'}`)}>
          Back {b?.name ?? 'defenders'}
        </Button>
      </div>
      {war.log[0] && <p className="mt-1.5 text-[11px] text-muted">{war.log[0].text}</p>}
    </div>
  );
}
