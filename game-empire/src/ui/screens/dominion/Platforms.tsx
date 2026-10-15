// Gaming Ecosystems and Company Keynotes.
import { useState } from 'react';
import { Layers, Mic, Sparkles } from 'lucide-react';
import { useWorld } from '../../../store/gameStore';
import { bestLevel, fmtPeople } from '../../../engine/dominionCore';
import { ECO_MAX_LEVEL, ECO_PARTS, ECO_PART_IDS, ecoBuildCost, ecoShare, exclusiveCost, foundEcosystem, partBlocker, setEcosystem, signExclusive, upgradePart } from '../../../engine/ecosystem';
import { KEYNOTE_COOLDOWN, REVEAL_LABELS, VENUES, cancelKeynote, maxReveals, planKeynote, previewScore, revealOptions, venueBlocker, venueCost } from '../../../engine/keynotes';
import { activeCorps, corpById } from '../../../engine/megacorps';
import { playerCompany } from '../../../engine/util';
import type { RevealItem } from '../../../engine/types';
import { date, money, pct } from '../../lib/format';
import { Badge, Button, Card, CompanyDot, ConfirmButton, Empty, Field, ScoreBadge, cx, inputClass } from '../../components/ui';
import { TimeChart } from '../../components/charts';
import { DecisionCard } from '../../components/Overlays';
import { FeatureGate, Mini, Pips, useAct } from './shared';

// ------------------------------------------------------------ ecosystem

export function EcoTab() {
  const w = useWorld();
  const act = useAct();
  const e = w.player.dominion.ecosystem;
  const [name, setName] = useState(`${playerCompany(w).name.split(' ')[0]} Nexus`);
  const pending = w.pendingEvents.filter((x) => x.kind === 'ecoDevs' || x.kind === 'ecoRegulator');
  return (
    <FeatureGate f="ecosystem">
      {!e ? (
        <Card title="Found a gaming ecosystem" subtitle="An operating system first, then a subscription, a marketplace, a cloud and devices. Every part makes the others stronger and pulls players away from rival platforms.">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64 max-w-full">
              <Field label="Name">
                <input className={inputClass} value={name} maxLength={24} onChange={(ev) => setName(ev.target.value)} />
              </Field>
            </div>
            <Button variant="primary" onClick={() => act((world) => foundEcosystem(world, name), `${name} is under construction`)}>
              <Layers size={14} /> Build the OS · {money(ecoBuildCost('os', 1))}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">Construction is paid day by day while it builds.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {pending.map((ev) => (
                <DecisionCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Mini label="Monthly users" value={fmtPeople(e.users)} />
            <Mini label="Share of all players" value={pct(ecoShare(w), 1)} tone={ecoShare(w) > 0.4 ? 'warn' : undefined} />
            <Mini label="Subscribers" value={fmtPeople(e.subscribers)} />
            <Mini label="Income" value={`${money(e.monthRevenue)}/mo`} tone="good" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
            <Card title={e.name} subtitle={`Founded ${date(e.founded)} · ${money(e.invested)} invested · upkeep ${money((e.invested * 0.06) / 12)}/mo · your games get +${pct(e.promo - 1)} visibility`}>
              <div className="space-y-2">
                {ECO_PART_IDS.map((part) => {
                  const lvl = e.levels[part];
                  const blocker = partBlocker(w, part);
                  const building = e.building?.part === part ? e.building : null;
                  const cost = lvl < ECO_MAX_LEVEL ? ecoBuildCost(part, lvl + 1) : 0;
                  return (
                    <div key={part} className="rounded-lg bg-surface-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            {ECO_PARTS[part].name} <Pips level={lvl} max={ECO_MAX_LEVEL} />
                          </div>
                          <div className="text-[11px] text-muted">{ECO_PARTS[part].blurb}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {lvl > 0 && <span className="text-xs tabular text-good">{money(e.partRevenue[part])}/mo</span>}
                          {lvl < ECO_MAX_LEVEL && !building && (
                            <Button size="sm" variant={lvl ? 'secondary' : 'primary'} disabled={!!blocker} title={blocker ?? undefined} onClick={() => act((world) => upgradePart(world, part), `${ECO_PARTS[part].name} level ${lvl + 1} under construction`)}>
                              {lvl ? `Level ${lvl + 1}` : 'Build'} · {money(cost)}
                            </Button>
                          )}
                        </div>
                      </div>
                      {building && (
                        <div className="mt-2">
                          <div className="flex justify-between text-[11px] text-muted">
                            <span>Building level {building.level}</span>
                            <span>{building.days - (w.day - building.start)} days left</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                            <div className="h-full bg-accent" style={{ width: `${((w.day - building.start) / building.days) * 100}%` }} />
                          </div>
                        </div>
                      )}
                      {blocker && !building && lvl < ECO_MAX_LEVEL && <div className="mt-1 text-[11px] text-warn">{blocker}</div>}
                    </div>
                  );
                })}
              </div>
            </Card>
            <div className="space-y-4">
              <Card title="Policy" subtitle="Open platforms and fair cuts attract developers; closed ones earn more per sale but draw regulators.">
                <div className="space-y-3">
                  <Field label="Subscription price" hint={`${money(e.subPrice, 2)}/mo`}>
                    <input type="range" min={4.99} max={49.99} step={1} value={e.subPrice} onChange={(ev) => act((world) => setEcosystem(world, { subPrice: Number(ev.target.value) }))} className="w-full" />
                  </Field>
                  <Field label="Marketplace cut" hint={pct(e.cut)}>
                    <input type="range" min={0.05} max={0.4} step={0.01} value={e.cut} onChange={(ev) => act((world) => setEcosystem(world, { cut: Number(ev.target.value) }))} className="w-full" />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={e.open} onChange={(ev) => act((world) => setEcosystem(world, { open: ev.target.checked }))} /> Open platform <span className="text-xs text-muted">(+15% pull, more developers)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={e.dayOne} onChange={(ev) => act((world) => setEcosystem(world, { dayOne: ev.target.checked }))} /> New games in the subscription on day one <span className="text-xs text-muted">(+35% subscribers, −12% sales)</span>
                  </label>
                  <div className="flex justify-between text-xs text-muted">
                    <span>Developers on your platform</span>
                    <span className="tabular text-ink">{pct(e.developers)}</span>
                  </div>
                </div>
              </Card>
              {e.history.length > 2 && (
                <Card title="Users">
                  <TimeChart height={140} format={fmtPeople} series={[{ key: 'u', name: 'Users', color: '#3987e5', data: e.history }]} />
                </Card>
              )}
            </div>
          </div>
          <Exclusives />
          <RivalPlatforms />
        </div>
      )}
    </FeatureGate>
  );
}

function Exclusives() {
  const w = useWorld();
  const act = useAct();
  const e = w.player.dominion.ecosystem!;
  const studios = Object.values(w.companies)
    .filter((c) => c.status === 'active' && !c.isPlayer && !c.parentId)
    .sort((a, b) => b.valuation - a.valuation)
    .slice(0, 8);
  const live = new Map(e.exclusives.filter((x) => x.until > w.day).map((x) => [x.companyId, x.until]));
  const cash = playerCompany(w).cash;
  return (
    <Card title="Exclusive deals" subtitle="Pay an independent studio to ship only on your platform for two years. Their games make your library stronger.">
      {studios.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {studios.map((c) => {
            const until = live.get(c.id);
            const corp = c.corpId ? corpById(w, c.corpId) : null;
            return (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <CompanyDot color={c.color} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-muted">
                      worth {money(c.valuation)}
                      {corp ? ` · owned by ${corp.name}` : ''}
                    </div>
                  </div>
                </div>
                {until ? (
                  <Badge tone="good">until {date(until)}</Badge>
                ) : (
                  <Button size="sm" disabled={cash < exclusiveCost(w, c.id) || e.levels.os < 1} onClick={() => act((world) => signExclusive(world, c.id), `${c.name} is exclusive to ${e.name}`)}>
                    Sign · {money(exclusiveCost(w, c.id))}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-sub">No independent studios left to sign.</p>
      )}
    </Card>
  );
}

function RivalPlatforms() {
  const w = useWorld();
  const corps = activeCorps(w)
    .filter((c) => c.assets.ecosystemUsers > 0)
    .sort((a, b) => b.assets.ecosystemUsers - a.assets.ecosystemUsers);
  if (!corps.length) return null;
  const e = w.player.dominion.ecosystem!;
  const max = Math.max(e.users, ...corps.map((c) => c.assets.ecosystemUsers));
  return (
    <Card title="Platform wars" subtitle="Rival megacorps' platforms. When you pass 25% of all players, they spend to win users back.">
      <div className="space-y-2">
        {[{ id: 'you', name: e.name, color: '#3987e5', users: e.users }, ...corps.map((c) => ({ id: c.id, name: c.name, color: c.color, users: c.assets.ecosystemUsers }))]
          .sort((a, b) => b.users - a.users)
          .map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs">
              <span className={cx('w-32 shrink-0 truncate', r.id === 'you' && 'font-semibold')} style={{ color: r.color }}>
                {r.name}
              </span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full" style={{ width: `${(r.users / Math.max(1, max)) * 100}%`, background: r.color }} />
              </div>
              <span className="w-16 shrink-0 text-right tabular text-sub">{fmtPeople(r.users)}</span>
            </div>
          ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ keynotes

export function KeynotesTab() {
  const w = useWorld();
  const act = useAct();
  const k = w.player.dominion.keynotes;
  const plan = k.plan;
  const cooldown = Math.max(0, KEYNOTE_COOLDOWN - (w.day - k.lastDay));
  return (
    <FeatureGate f="keynotes">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="Keynotes held" value={w.player.dominion.stats.keynotes} />
          <Mini label="Best score" value={k.history.length ? Math.max(...k.history.map((x) => x.score)) : '—'} />
          <Mini label="Next possible" value={plan ? 'Booked' : cooldown ? `in ${cooldown} days` : 'Now'} />
          <Mini label="Rival spotlight" value={w.day < k.rivalSpotlightUntil ? `${k.rivalSpotlightUntil - w.day} more days` : 'None'} tone={w.day < k.rivalSpotlightUntil ? 'warn' : undefined} />
        </div>
        {plan ? (
          <Card
            title={
              <span className="flex items-center gap-1.5">
                <Mic size={14} className="text-accent" /> {plan.title}
              </span>
            }
            subtitle={`${VENUES[plan.venue].name} · ${date(plan.day)} (in ${plan.day - w.day} days)`}
            actions={
              <ConfirmButton onConfirm={() => act((world) => cancelKeynote(world), 'Keynote cancelled')} confirmLabel="Cancel? 40% back">
                Cancel
              </ConfirmButton>
            }
          >
            <ul className="space-y-1.5 text-sm">
              {plan.reveals.map((r) => (
                <li key={r.kind + r.refId} className="flex items-center gap-2">
                  <Badge tone="neutral">{REVEAL_LABELS[r.kind]}</Badge>
                  {r.label}
                  {r.surprise && (
                    <Badge tone="accent">
                      <Sparkles size={10} /> One more thing
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Expected audience score about {previewScore(w, plan.reveals, plan.venue)}. Leaks (moles you haven’t found) spoil surprises; a rival keynote the same week splits the room.</p>
          </Card>
        ) : cooldown > 0 ? (
          <Card>
            <p className="text-sm text-sub">The press needs a breather: your next keynote can be booked in {cooldown} days.</p>
          </Card>
        ) : (
          <Planner />
        )}
        <UpcomingRivals />
        {k.history.length > 0 && (
          <Card title="Past keynotes">
            <div className="space-y-2">
              {k.history.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className="text-[11px] text-muted">
                      {date(r.day)} · {VENUES[r.venue].name} · {r.items.map((x) => x.label).join(', ')}
                      {r.leaked ? ' · leaked' : ''}
                      {r.clash ? ` · clashed with ${r.clash}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={r.stockMove >= 0 ? 'text-good' : 'text-bad'}>
                      stock {r.stockMove >= 0 ? '+' : ''}
                      {pct(r.stockMove, 1)}
                    </span>
                    <ScoreBadge score={r.score} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </FeatureGate>
  );
}

function Planner() {
  const w = useWorld();
  const act = useAct();
  const p = playerCompany(w);
  const [title, setTitle] = useState(`${p.name} Live`);
  const [venue, setVenue] = useState(() => {
    let v = 0;
    for (let i = 0; i < VENUES.length; i++) if (!venueBlocker(w, i) && venueCost(w, i) < p.cash * 0.2) v = i;
    return v;
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [surprise, setSurprise] = useState<string | null>(null);
  const options = revealOptions(w);
  const key = (r: { kind: string; refId: string }) => `${r.kind}:${r.refId}`;
  const max = maxReveals(venue);
  const reveals: RevealItem[] = options.filter((o) => picked.includes(key(o))).map((o) => ({ kind: o.kind, refId: o.refId, label: o.label, surprise: key(o) === surprise }));
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= max ? cur : [...cur, id]));
  const score = previewScore(w, reveals, venue);
  return (
    <Card title="Plan a keynote" subtitle="Book a venue, pick what to show, and hold one thing back for the finale. Unfinished things can crash on stage.">
      <div className="space-y-4">
        <div className="w-80 max-w-full">
          <Field label="Show title">
            <input className={inputClass} value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-sub">Venue</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {VENUES.map((v, i) => {
              const blocker = venueBlocker(w, i);
              return (
                <button
                  key={v.name}
                  disabled={!!blocker}
                  onClick={() => setVenue(i)}
                  title={blocker ?? undefined}
                  className={cx('rounded-lg border p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-40', venue === i ? 'border-accent bg-accent-soft/30' : 'border-line bg-surface-2 hover:border-sub')}
                >
                  <div className="text-xs font-semibold">{v.name}</div>
                  <div className="text-[11px] text-muted">{v.blurb}</div>
                  <div className="mt-1 text-[11px] tabular text-sub">
                    {money(venueCost(w, i))} · reach ×{v.reach} · {maxReveals(i)} reveals · {v.prep}d prep
                  </div>
                  {blocker && <div className="mt-1 text-[11px] text-warn">{blocker}</div>}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="font-medium text-sub">
              Reveals ({picked.length}/{max})
            </span>
            <span className="text-muted">Click the star to make it the “one more thing”.</span>
          </div>
          {options.length ? (
            <div className="grid gap-1.5 md:grid-cols-2">
              {options.map((o) => {
                const id = key(o);
                const on = picked.includes(id);
                const ready = Math.max(0, Math.min(1, o.readiness));
                return (
                  <div key={id} className={cx('flex items-center gap-2 rounded-lg border px-2.5 py-2', on ? 'border-accent bg-accent-soft/20' : 'border-line bg-surface-2')}>
                    <input type="checkbox" checked={on} onChange={() => toggle(id)} aria-label={o.label} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{o.label}</div>
                      <div className="text-[11px] text-muted">
                        {REVEAL_LABELS[o.kind]} · appeal {Math.round(o.base)}
                        {o.stale && <span className="text-warn"> · old news</span>}
                        {ready < 1 && <span className={ready < 0.4 ? 'text-warn' : ''}> · {pct(ready)} ready</span>}
                      </div>
                    </div>
                    <button
                      disabled={!on}
                      onClick={() => setSurprise(surprise === id ? null : id)}
                      className={cx('rounded p-1 disabled:opacity-30', surprise === id ? 'text-warn' : 'text-muted hover:text-ink')}
                      aria-label="One more thing"
                      title="One more thing: a bigger reaction if it lands"
                    >
                      <Sparkles size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon={<Mic size={20} />} title="Nothing to show yet">
              Start a game, design a console, train an AI or build something big, then come back.
            </Empty>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
          <div className="text-sm">
            Expected score <span className="font-semibold tabular">{score || '—'}</span>
            <span className="text-xs text-muted"> · great shows raise your stock, hype your games, sell consoles and swing wars</span>
          </div>
          <Button variant="primary" disabled={!reveals.length || !!venueBlocker(w, venue) || p.cash < venueCost(w, venue)} onClick={() => act((world) => planKeynote(world, { title, venue, reveals }), `${title} is booked`)}>
            <Mic size={14} /> Book it · {money(venueCost(w, venue))}
          </Button>
        </div>
        {bestLevel(w) < 4 && <p className="text-[11px] text-muted">Bigger venues unlock as your empire grows.</p>}
      </div>
    </Card>
  );
}

function UpcomingRivals() {
  const w = useWorld();
  const k = w.player.dominion.keynotes;
  const spy = w.player.dominion.spy;
  const shown = k.upcoming.filter((x) => x.day - w.day <= 14 || (spy.intel[x.corpId] ?? 0) >= 30);
  const hidden = k.upcoming.length - shown.length;
  if (!k.upcoming.length) return null;
  return (
    <Card title="Rival keynotes" subtitle="Announced two weeks ahead. Intel on a rival reveals their plans sooner. Two shows in the same week split the audience.">
      <ul className="space-y-1.5 text-sm">
        {shown.map((x) => {
          const c = corpById(w, x.corpId);
          return (
            <li key={x.corpId + x.day} className="flex justify-between gap-2">
              <span>
                <span style={{ color: c?.color }}>{c?.name}</span>: {x.title.replace(' (overshadowed)', '')}
              </span>
              <span className="text-xs text-muted">{date(x.day)}</span>
            </li>
          );
        })}
        {hidden > 0 && <li className="text-xs text-muted">{hidden} more rumoured. Steal a roadmap to find out when.</li>}
      </ul>
    </Card>
  );
}
