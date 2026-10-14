import { useState, type ReactNode } from 'react';
import { BrainCircuit, Check, Clapperboard, Crown, FerrisWheel, Gamepad, Lock, ShieldCheck, TrendingUp } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { REGIONS, REGION_IDS } from '../../engine/constants';
import { EMPIRE_CHALLENGES, EMPIRE_LEVELS, LEVEL_REWARD, courtOdds, decreeActive, empireLevel, empireUpkeep, strikeActive, upkeepDiscount } from '../../engine/empire';
import {
  AI_LAB_COST,
  CONSOLE_SIZES,
  FILM_TIERS,
  MAX_LANDS,
  PARK_TICKET,
  RESEARCHER_SALARY,
  VENTURES,
  acBuildCost,
  acBuildDays,
  acEffectiveness,
  addLand,
  aiLead,
  aiSpeedBoost,
  aiTrainCost,
  aiTrainDays,
  bestModel,
  buildPark,
  computeDiscount,
  consoleDevDays,
  consoleMarketingCost,
  consolePowerRatio,
  consoleRdCost,
  consoleShare,
  consolesInstalled,
  designConsole,
  foundAiLab,
  foundAntiCheat,
  greenlightFilm,
  hireResearchers,
  landCost,
  marketConsole,
  nextConsoleGen,
  nextModelGen,
  parkCost,
  parkVisitors,
  retireConsole,
  setAiLicensing,
  setAntiCheat,
  setConsolePrice,
  startAntiCheatVersion,
  startTraining,
  trainingOdds,
  ventureBlocker,
  type VentureId,
} from '../../engine/ventures';
import { playerCompany } from '../../engine/util';
import type { ConsoleSize, RegionId } from '../../engine/types';
import { date, money, num, pct } from '../lib/format';
import { Badge, Button, Card, Kv, Progress, SectionTitle, Stat, Tabs, cx, inputClass } from '../components/ui';

type Tab = 'overview' | VentureId;

const TAB_ICONS: Record<VentureId, ReactNode> = {
  antiCheat: <ShieldCheck size={14} />,
  consoles: <Gamepad size={14} />,
  ai: <BrainCircuit size={14} />,
  films: <Clapperboard size={14} />,
  parks: <FerrisWheel size={14} />,
};
const VENTURE_ORDER: VentureId[] = ['antiCheat', 'films', 'consoles', 'parks', 'ai'];

export function EmpireScreen({ tab: initial }: { tab?: string }) {
  const w = useWorld();
  const [tab, setTab] = useState<Tab>(((initial && (initial === 'overview' || initial in VENTURES)) ? initial : 'overview') as Tab);
  const lvl = empireLevel(w);
  return (
    <div className="space-y-4">
      <SectionTitle actions={<Badge tone="accent">Level {lvl} · {EMPIRE_LEVELS[lvl].name}</Badge>}>Empire</SectionTitle>
      <div className="overflow-x-auto">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: <span className="flex items-center gap-1.5"><Crown size={14} /> Overview</span> },
            ...VENTURE_ORDER.map((id) => ({
              id,
              label: (
                <span className="flex items-center gap-1.5">
                  {TAB_ICONS[id]} {VENTURES[id].name}
                  {ventureBlocker(w, id) && !started(w, id) && <Lock size={11} className="text-muted" />}
                </span>
              ),
            })),
          ]}
        />
      </div>
      {tab === 'overview' && <Overview onOpen={setTab} />}
      {tab === 'antiCheat' && <AntiCheatTab />}
      {tab === 'consoles' && <ConsolesTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'films' && <FilmsTab />}
      {tab === 'parks' && <ParksTab />}
    </div>
  );
}

function started(w: ReturnType<typeof useWorld>, id: VentureId): boolean {
  const v = w.player.ventures;
  return id === 'antiCheat' ? !!v.antiCheat : id === 'ai' ? !!v.ai : id === 'consoles' ? v.consoles.length > 0 : id === 'films' ? v.films.length > 0 : v.parks.length > 0;
}

function Locked({ id }: { id: VentureId }) {
  const w = useWorld();
  const blocker = ventureBlocker(w, id);
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Lock size={18} className="mt-0.5 text-muted" />
        <div>
          <div className="text-sm font-semibold">{VENTURES[id].name} is locked</div>
          <p className="mt-1 text-sm text-sub">{VENTURES[id].blurb}</p>
          <p className="mt-2 text-sm text-warn">{blocker}</p>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ overview

function Overview({ onOpen }: { onOpen: (t: Tab) => void }) {
  const w = useWorld();
  const p = playerCompany(w);
  const lvl = empireLevel(w);
  const def = EMPIRE_LEVELS[lvl];
  const next = EMPIRE_LEVELS[lvl + 1];
  const upkeep = empireUpkeep(w);
  const e = w.player.empire;
  const progress = next ? Math.max(0, Math.min(1, Math.log10(Math.max(1, p.valuation) / Math.max(1, def.min)) / Math.log10(next.min / Math.max(1, def.min || 1e7)))) : 1;
  const v = w.player.ventures;

  const summaries: Record<VentureId, string> = {
    antiCheat: v.antiCheat ? `v${v.antiCheat.version} · ${pct(acEffectiveness(w))} effective · ${v.antiCheat.licensees.length} studios` : 'Not started',
    films: v.films.length ? `${v.films.filter((f) => f.stage === 'released').length} released · ${money(v.films.reduce((s, f) => s + f.earned, 0))} box office` : 'Not started',
    consoles: v.consoles.length ? `${num(consolesInstalled(w))} in homes · ${pct(consoleShare(w))} share` : 'Not started',
    parks: v.parks.length ? `${v.parks.filter((x) => x.stage === 'open').length} open · ${num(v.parks.reduce((s, x) => s + x.visitors, 0))} visitors/day` : 'Not started',
    ai: v.ai ? (bestModel(w) ? `${bestModel(w)!.name} · ${pct(aiLead(w))} of the frontier` : 'No model yet') : 'Not started',
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Empire level {lvl}</div>
              <div className="mt-0.5 flex items-center gap-2 text-2xl font-bold">
                <Crown size={22} className="text-warn" /> {def.name}
              </div>
              <p className="mt-1 text-sm text-sub">{def.blurb}</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Company value</div>
              <div className="text-xl font-semibold tabular">{money(p.valuation)}</div>
            </div>
          </div>
          {next ? (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>Next: {next.name}</span>
                <span className="tabular">{money(next.min)}</span>
              </div>
              <Progress value={progress} max={1} tone="warn" />
              <p className="mt-2 text-xs text-muted">The next level is harder: {next.blurb.charAt(0).toLowerCase() + next.blurb.slice(1)}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-good">You reached the top level. Survive it.</p>
          )}
        </Card>
        <Card title="What makes this level hard" subtitle="Pressure grows with your size. Clearing a level's challenges cuts upkeep by 10%.">
          <div className="space-y-1.5 text-sm">
            <Kv k="Empire upkeep this month" v={upkeep.total > 0 ? money(upkeep.total) : 'none'} tone={upkeep.total > 0 ? 'warn' : undefined} />
            {upkeep.total > 0 && (
              <div className="text-[11px] text-muted">
                {pct(def.overhead * upkeepDiscount(w))} of revenue + {pct(def.cashDrag * upkeepDiscount(w), 2)} of cash a month (lawyers, lobbyists, security)
              </div>
            )}
            <Kv k="Antitrust risk" v={def.antitrust ? `${pct(def.antitrust)}/month · ${pct(courtOdds(w))} in court` : 'none'} tone={def.antitrust ? 'warn' : undefined} />
            <Kv k="Crises (hacks, unions)" v={def.crisis ? `${pct(def.crisis)}/month` : 'none'} tone={def.crisis ? 'warn' : undefined} />
            <Kv k="Critics expect more" v={def.critics ? `-${def.critics} review points` : 'no'} tone={def.critics ? 'warn' : undefined} />
            <Kv k="Rivals, cheaters and AI labs" v={def.rivalPace ? `${pct(def.rivalPace)} faster` : 'normal pace'} tone={def.rivalPace ? 'warn' : undefined} />
            <Kv k="Rival game quality" v={def.rivalQuality ? `+${pct(def.rivalQuality, 1)}` : 'normal'} />
            {decreeActive(w) && <div className="rounded-md bg-warn-soft/60 px-2 py-1 text-xs text-warn">Consent decree until {date(e.decreeUntil)}: platform and licence income halved.</div>}
            {strikeActive(w) && <div className="rounded-md bg-bad-soft/60 px-2 py-1 text-xs text-bad">Your developers are on strike until {date(e.strikeUntil)}.</div>}
            <div className="pt-1 text-[11px] text-muted">
              Lifetime: {money(e.overheadPaid)} upkeep, {money(e.finesPaid)} fines, {e.investigations} investigation{e.investigations === 1 ? '' : 's'}, {e.courtWins} court win{e.courtWins === 1 ? '' : 's'}.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Ventures" subtitle="Businesses beyond games. Every generation costs more, and rivals keep getting better.">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {VENTURE_ORDER.map((id) => {
            const blocker = ventureBlocker(w, id);
            const live = started(w, id);
            return (
              <button key={id} onClick={() => onOpen(id)} className={cx('rounded-lg border p-3 text-left transition-colors hover:border-sub', live ? 'border-accent/50 bg-accent-soft/20' : 'border-line bg-surface-2')}>
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  {TAB_ICONS[id]} {VENTURES[id].name}
                </div>
                <div className={cx('mt-1 text-xs', blocker && !live ? 'text-warn' : 'text-sub')}>{blocker && !live ? blocker : summaries[id]}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Level challenges" subtitle={`Finish every challenge of a level you have reached: +${LEVEL_REWARD.perkPoints} perk points, ${num(LEVEL_REWARD.xp)} XP and 10% off empire upkeep.`}>
        <div className="space-y-3">
          {EMPIRE_LEVELS.map((L, i) => {
            const list = EMPIRE_CHALLENGES.filter((c) => c.level === i);
            if (!list.length) return null;
            const reached = i <= e.best;
            const cleared = e.cleared.includes(i);
            return (
              <div key={i} className={cx('rounded-lg border p-3', cleared ? 'border-good/40 bg-good-soft/20' : reached ? 'border-accent/40' : 'border-line-soft opacity-70')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {cleared ? <Check size={14} className="text-good" /> : reached ? <TrendingUp size={14} className="text-accent" /> : <Lock size={13} className="text-muted" />}
                    Level {i} · {L.name}
                  </div>
                  <span className="text-xs text-muted tabular">{reached ? (cleared ? 'Cleared' : `${list.filter((c) => e.done.includes(c.id)).length}/${list.length} done`) : `Unlocks at ${money(L.min)}`}</span>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {list.map((c) => {
                    const [have, need] = c.progress(w);
                    const done = e.done.includes(c.id);
                    return (
                      <div key={c.id} className="rounded-md bg-surface-2 px-2.5 py-2">
                        <div className={cx('text-xs', done ? 'text-good' : 'text-ink')}>
                          {done && <Check size={11} className="mr-1 inline" />}
                          {c.name}
                        </div>
                        {!done && (
                          <>
                            <Progress value={Math.min(have, need)} max={need} height={4} className="mt-1.5" />
                            <div className="mt-0.5 text-[10px] text-muted tabular">
                              {need >= 1e6 ? `${num(have)} / ${num(need)}` : `${Math.round(have)} / ${need}`}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ anti-cheat

function AntiCheatTab() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const [name, setName] = useState(`${playerCompany(w).name.split(' ')[0]} Shield`);
  const ac = w.player.ventures.antiCheat;
  if (!ac) {
    if (ventureBlocker(w, 'antiCheat')) return <Locked id="antiCheat" />;
    return (
      <Card title="Build your own anti-cheat" subtitle={VENTURES.antiCheat.blurb}>
        <div className="flex flex-wrap items-end gap-2">
          <input aria-label="Anti-cheat name" className={cx(inputClass, 'w-56')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" onClick={() => act((world) => foundAntiCheat(world, name), `${name} 1.0 is in development`)}>
            <ShieldCheck size={14} /> Start version 1 · {money(acBuildCost(1))} · {acBuildDays(1)} days
          </Button>
        </div>
      </Card>
    );
  }
  const e = acEffectiveness(w);
  const cheat = w.player.ventures.cheatLevel;
  const names = ac.licensees.map((id) => w.companies[id]?.name).filter(Boolean);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Version" value={ac.version ? `${ac.name} ${ac.version}.0` : 'In development'} />
        <Stat label="Stops cheaters" value={pct(e)} tone={e >= 0.6 ? 'good' : e >= 0.35 ? 'warn' : 'bad'} sub={`Cheat makers ${Math.round(cheat)} vs you ${Math.round(ac.strength + (ac.mode === 'kernel' ? 8 : 0))}`} />
        <Stat label="Studios licensing it" value={ac.licensees.length} />
        <Stat label="Licence income (lifetime)" value={money(ac.revenue)} />
      </div>
      {w.day < ac.breachUntil && <div className="rounded-lg border border-bad/30 bg-bad-soft/50 px-3 py-2 text-sm text-bad">Cheaters broke through. Your online games lose extra players until {date(ac.breachUntil)}. Ship a new version.</div>}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card title="Development" subtitle="Cheat makers get better every day, faster the bigger your empire. Each version costs 2.4× the last.">
          {ac.building ? (
            <div>
              <div className="flex justify-between text-sm">
                <span>Version {ac.building.version}.0</span>
                <span className="tabular text-muted">ships {date(ac.building.start + ac.building.days)}</span>
              </div>
              <Progress value={w.day - ac.building.start} max={ac.building.days} className="mt-2" />
              <div className="mt-1 text-xs text-muted">{money(ac.building.spent)} of {money(ac.building.cost)} spent</div>
            </div>
          ) : (
            <div>
              <Button variant="primary" onClick={() => act((world) => startAntiCheatVersion(world), `Version ${ac.version + 1}.0 is in development`)}>
                Build version {ac.version + 1}.0 · {money(acBuildCost(ac.version + 1))}
              </Button>
              <div className="mt-1 text-xs text-muted">{acBuildDays(ac.version + 1)} days</div>
            </div>
          )}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium text-sub">Driver</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['standard', 'kernel'] as const).map((m) => (
                <button key={m} onClick={() => act((world) => setAntiCheat(world, { mode: m }))} className={cx('rounded-lg border px-2.5 py-2 text-left', ac.mode === m ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}>
                  <div className="text-xs font-semibold">{m === 'standard' ? 'Standard' : 'Kernel-level'}</div>
                  <div className="text-[11px] text-muted">{m === 'standard' ? 'Respectful of players’ PCs.' : '+8 strength, but privacy backlash can hit your reputation.'}</div>
                </button>
              ))}
            </div>
          </div>
        </Card>
        <Card
          title="Sell it to rival studios"
          subtitle="Studios with online games license it for a share of their online revenue. They drop it if cheaters get through."
          actions={
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={ac.licensing} onChange={(ev) => act((world) => setAntiCheat(world, { licensing: ev.target.checked }))} /> Licensing
            </label>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-sub">Fee</span>
            <select aria-label="Licence fee" className={cx(inputClass, 'h-8 w-40 text-xs')} value={ac.fee} onChange={(ev) => act((world) => setAntiCheat(world, { fee: Number(ev.target.value) }))}>
              {[0.01, 0.02, 0.03, 0.04, 0.05, 0.06].map((f) => (
                <option key={f} value={f}>
                  {pct(f)} of online revenue
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">Lower fees win more studios.</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {names.length ? names.slice(0, 24).map((n) => <Badge key={n}>{n}</Badge>) : <span className="text-xs text-muted">No licensees yet. Studios sign up month by month while your anti-cheat works well.</span>}
            {names.length > 24 && <Badge>+{names.length - 24} more</Badge>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ consoles

function ConsolesTab() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const v = w.player.ventures;
  const gen = nextConsoleGen(w);
  const [name, setName] = useState(`${playerCompany(w).name.split(' ')[0]} Box`);
  const [size, setSize] = useState<ConsoleSize>('home');
  const [price, setPrice] = useState(CONSOLE_SIZES.home.refPrice);
  const designing = v.consoles.find((c) => c.stage === 'design');
  const blocker = ventureBlocker(w, 'consoles');
  if (blocker && !v.consoles.length) return <Locked id="consoles" />;
  const rd = consoleRdCost(gen, size);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Your consoles in homes" value={num(consolesInstalled(w))} />
        <Stat label="Share of all consoles" value={pct(consoleShare(w), 1)} sub="Your cut of every console game sold" />
        <Stat label="Hardware & fees (lifetime)" value={money(v.consoles.reduce((s, c) => s + c.revenue + c.fees, 0))} />
        <Stat label="Best rival console power" value={num(v.rivalPower)} sub="Keeps rising" />
      </div>
      {designing ? (
        <Card title={`${designing.name} (generation ${designing.gen}) in development`}>
          <div className="flex justify-between text-sm">
            <span>{CONSOLE_SIZES[designing.size].name} · ${designing.price}</span>
            <span className="tabular text-muted">launches {date(designing.launchDay)}</span>
          </div>
          <Progress value={w.day - designing.startDay} max={designing.launchDay - designing.startDay} className="mt-2" />
          <div className="mt-1 text-xs text-muted">{money(designing.rdSpent)} of {money(designing.rdCost)} R&D spent</div>
        </Card>
      ) : blocker ? (
        <Locked id="consoles" />
      ) : (
        <Card title={`Design generation ${gen}`} subtitle="Its power is set at launch against the best rival machine. Each generation costs 2.5× the last.">
          <div className="grid gap-2 md:grid-cols-3">
            {(Object.keys(CONSOLE_SIZES) as ConsoleSize[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSize(s);
                  setPrice(CONSOLE_SIZES[s].refPrice);
                }}
                className={cx('rounded-lg border p-3 text-left', size === s ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}
              >
                <div className="text-sm font-semibold">{CONSOLE_SIZES[s].name}</div>
                <div className="text-[11px] text-muted">{CONSOLE_SIZES[s].blurb}</div>
                <div className="mt-2 text-[11px] text-sub tabular">
                  R&D {money(consoleRdCost(gen, s))} · {consoleDevDays(gen, s)} days · power {pct(CONSOLE_SIZES[s].powerMult)} of rivals
                </div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input aria-label="Console name" className={cx(inputClass, 'w-48')} value={name} onChange={(e) => setName(e.target.value)} />
            <label className="flex items-center gap-1 text-sm">
              $<input aria-label="Console price" type="number" className={cx(inputClass, 'w-24')} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            </label>
            <span className="text-xs text-muted">Costs about ${CONSOLE_SIZES[size].unitCost} to make at launch.</span>
            <Button variant="primary" onClick={() => act((world) => designConsole(world, { name, size, price }), `${name} is in development`)}>
              <Gamepad size={14} /> Start · {money(rd)}
            </Button>
          </div>
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {v.consoles
          .filter((c) => c.stage !== 'design')
          .slice()
          .reverse()
          .map((c) => (
            <ConsoleCard key={c.id} id={c.id} />
          ))}
      </div>
    </div>
  );
}

function ConsoleCard({ id }: { id: string }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = w.player.ventures.consoles.find((x) => x.id === id)!;
  const [price, setPrice] = useState(c.price);
  const ratio = consolePowerRatio(w, c);
  return (
    <Card
      title={`${c.name}`}
      subtitle={`Generation ${c.gen} · ${CONSOLE_SIZES[c.size].name} · launched ${date(c.launchDay)}`}
      actions={<Badge tone={c.stage === 'live' ? 'good' : 'neutral'}>{c.stage === 'live' ? 'On sale' : 'Retired'}</Badge>}
    >
      <div className="space-y-1 text-sm">
        <Kv k="Power vs best rival" v={pct(ratio)} tone={ratio >= 0.9 ? 'good' : ratio >= 0.7 ? 'warn' : 'bad'} />
        <Kv k="In homes" v={num(c.installed)} />
        <Kv k="Selling" v={`${num(c.dailySales)}/day`} />
        <Kv k="Price / cost to make" v={`$${c.price} / $${Math.round(c.unitCost)}`} tone={c.price < c.unitCost ? 'warn' : undefined} />
        <Kv k="Hardware revenue" v={money(c.revenue)} />
        <Kv k="Platform fees" v={money(c.fees)} />
      </div>
      {c.stage === 'live' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            $<input aria-label={`${c.name} price`} type="number" className={cx(inputClass, 'h-8 w-20 text-xs')} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </label>
          <Button size="sm" onClick={() => act((world) => setConsolePrice(world, c.id, price), 'Price updated')}>
            Set price
          </Button>
          <Button size="sm" disabled={w.day < c.marketingUntil} onClick={() => act((world) => marketConsole(world, c.id), 'Ad campaign running for 90 days')}>
            {w.day < c.marketingUntil ? 'Campaign running' : `Advertise · ${money(consoleMarketingCost(c))}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => act((world) => retireConsole(world, c.id), `${c.name} retired`)}>
            Retire
          </Button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ AI lab

function AiTab() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const [name, setName] = useState(`${playerCompany(w).name.split(' ')[0]} AI`);
  const ai = w.player.ventures.ai;
  if (!ai) {
    if (ventureBlocker(w, 'ai')) return <Locked id="ai" />;
    return (
      <Card title="Found an AI lab" subtitle={VENTURES.ai.blurb}>
        <div className="flex flex-wrap items-end gap-2">
          <input aria-label="Lab name" className={cx(inputClass, 'w-56')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" onClick={() => act((world) => foundAiLab(world, name), `${name} is open`)}>
            <BrainCircuit size={14} /> Found the lab · {money(AI_LAB_COST)}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">Starts with 100 researchers ({money(100 * RESEARCHER_SALARY)}/mo). Owning data centers makes training up to 40% cheaper.</p>
      </Card>
    );
  }
  const m = bestModel(w);
  const lead = aiLead(w);
  const gen = nextModelGen(w);
  const v = w.player.ventures;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Best model" value={m ? m.name : 'None yet'} sub={m ? `Generation ${m.gen} · quality ${Math.round(m.quality)}` : undefined} />
        <Stat label="Vs best rival lab" value={m ? pct(lead) : '—'} tone={lead >= 1 ? 'good' : lead >= 0.8 ? 'warn' : 'bad'} sub={`Frontier quality ${Math.round(v.aiFrontier)}`} />
        <Stat label="AI revenue" value={`${money(ai.dailyRevenue * 30)}/mo`} sub={`AI market ${money(v.aiMarket)}/yr`} />
        <Stat label="Your developers" value={`+${pct(aiSpeedBoost(w) - 1)} speed`} sub="From your own AI tools" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card title="Training" subtitle="Each generation needs 3× the compute of the last. Rival labs keep improving, faster the bigger your empire.">
          {ai.training ? (
            <div>
              <div className="flex justify-between text-sm">
                <span>Generation {ai.training.gen}</span>
                <span className="tabular text-muted">done {date(ai.training.start + ai.training.days)}</span>
              </div>
              <Progress value={w.day - ai.training.start} max={ai.training.days} className="mt-2" />
              <div className="mt-1 text-xs text-muted">
                {money(ai.training.spent)} of {money(ai.training.cost)} compute · {pct(trainingOdds(w, ai.training.gen))} chance it works
              </div>
            </div>
          ) : (
            <div>
              <Button variant="primary" onClick={() => act((world) => startTraining(world), `Generation ${gen} is training`)}>
                Train generation {gen} · {money(aiTrainCost(w, gen))}
              </Button>
              <div className="mt-1 text-xs text-muted">
                {aiTrainDays(gen)} days · {pct(trainingOdds(w, gen))} chance it works
              </div>
            </div>
          )}
          <div className="mt-2 text-xs text-muted">Data center compute discount: {pct(computeDiscount(w))}</div>
          <div className="mt-3 space-y-1">
            {ai.models
              .slice()
              .reverse()
              .slice(0, 8)
              .map((x) => (
                <div key={x.id} className="flex justify-between text-xs">
                  <span>{x.name}</span>
                  <span className="tabular text-muted">
                    gen {x.gen} · quality {Math.round(x.quality)} · {date(x.day)}
                  </span>
                </div>
              ))}
          </div>
        </Card>
        <Card title="Researchers" subtitle="More researchers: better models, better odds, fewer safety incidents.">
          <div className="text-2xl font-semibold tabular">{num(ai.researchers)}</div>
          <div className="text-xs text-muted">{money(ai.researchers * RESEARCHER_SALARY)}/mo in salaries · {ai.incidents} safety incident{ai.incidents === 1 ? '' : 's'}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => act((world) => hireResearchers(world, 50), 'Hired 50 researchers')}>
              +50 · {money(50 * 50000)}
            </Button>
            <Button size="sm" onClick={() => act((world) => hireResearchers(world, 250), 'Hired 250 researchers')}>
              +250 · {money(250 * 50000)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act((world) => hireResearchers(world, -50))}>
              Let 50 go
            </Button>
          </div>
          <div className="mt-4 border-t border-line-soft pt-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ai.licensing} onChange={(ev) => act((world) => setAiLicensing(world, ev.target.checked))} />
              <span>
                Sell AI dev tools to rival studios
                <span className="block text-xs text-muted">They pay monthly per developer and work 15% faster. {ai.licensees.length} studio{ai.licensees.length === 1 ? '' : 's'} signed up.</span>
              </span>
            </label>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ films

function FilmsTab() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const p = playerCompany(w);
  const games = Object.values(w.games)
    .filter((g) => g.companyId === p.id && g.status === 'released')
    .sort((a, b) => b.owners - a.owners)
    .slice(0, 40);
  const [gameId, setGameId] = useState(games[0]?.id ?? '');
  const [tier, setTier] = useState(1);
  const films = w.player.ventures.films;
  if (ventureBlocker(w, 'films') && !films.length) return <Locked id="films" />;
  return (
    <div className="space-y-4">
      <Card title="Greenlight a film" subtitle="Famous, well-reviewed games make the biggest movies. Sequels wear audiences out, and critics expect more from big empires.">
        <div className="grid gap-2 md:grid-cols-4">
          {FILM_TIERS.map((t, i) => (
            <button key={t.name} onClick={() => setTier(i)} className={cx('rounded-lg border p-3 text-left', tier === i ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}>
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="text-[11px] text-muted tabular">
                {money(t.budget)} · {t.days} days
              </div>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select aria-label="Game to adapt" className={cx(inputClass, 'w-72 max-w-full')} value={gameId} onChange={(e) => setGameId(e.target.value)}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title} · {num(g.owners)} players · {g.criticScore}
              </option>
            ))}
          </select>
          <Button variant="primary" disabled={!gameId} onClick={() => act((world) => greenlightFilm(world, gameId, tier), 'Cameras are rolling')}>
            <Clapperboard size={14} /> Greenlight · {money(FILM_TIERS[tier].budget)}
          </Button>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {films
          .slice()
          .reverse()
          .map((f) => (
            <Card key={f.id} title={f.title} subtitle={`${FILM_TIERS[f.tier].name} · ${money(f.budget)}`}>
              {f.stage === 'production' ? (
                <>
                  <Progress value={w.day - f.start} max={f.releaseDay - f.start} />
                  <div className="mt-1 text-xs text-muted">In cinemas {date(f.releaseDay)}</div>
                </>
              ) : (
                <div className="space-y-1 text-sm">
                  <Kv k="Critics" v={`${f.score}/100`} tone={f.score >= 70 ? 'good' : f.score >= 50 ? undefined : 'bad'} />
                  <Kv k="Box office" v={money(f.gross)} tone={f.gross >= f.budget * 2 ? 'good' : f.gross < f.budget ? 'bad' : undefined} />
                  <Kv k="Earned so far" v={money(f.earned)} />
                  <Kv k="Return" v={`${(f.gross / f.budget).toFixed(1)}×`} />
                </div>
              )}
            </Card>
          ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ theme parks

function ParksTab() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const p = playerCompany(w);
  const [name, setName] = useState(`${p.name.split(' ')[0]} World`);
  const [region, setRegion] = useState<RegionId>('na');
  const parks = w.player.ventures.parks;
  if (ventureBlocker(w, 'parks') && !parks.length) return <Locked id="parks" />;
  const ips = Object.values(w.ips)
    .filter((ip) => ip.companyId === p.id)
    .sort((a, b) => b.fans - a.fans);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Parks open" value={parks.filter((x) => x.stage === 'open').length} />
        <Stat label="Visitors today" value={num(parks.reduce((s, x) => s + x.visitors, 0))} />
        <Stat label="Park revenue (lifetime)" value={money(parks.reduce((s, x) => s + x.revenue, 0))} />
        <Stat label="Ticket + food + merch" value={`$${PARK_TICKET}`} sub="per visitor" />
      </div>
      {!ventureBlocker(w, 'parks') && (
        <Card title="Build a park" subtitle="Takes a year to build. Every park costs 1.6× the last; parks in the same region share visitors.">
          <div className="flex flex-wrap items-end gap-2">
            <input aria-label="Park name" className={cx(inputClass, 'w-56')} value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label="Park region" className={cx(inputClass, 'w-48')} value={region} onChange={(e) => setRegion(e.target.value as RegionId)}>
              {REGION_IDS.map((r) => (
                <option key={r} value={r}>
                  {REGIONS[r].name}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={() => act((world) => buildPark(world, region, name), `${name} is under construction`)}>
              <FerrisWheel size={14} /> Build · {money(parkCost(w))}
            </Button>
          </div>
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {parks.map((park) => (
          <ParkCard key={park.id} id={park.id} ips={ips.map((ip) => ({ id: ip.id, name: ip.name }))} />
        ))}
      </div>
    </div>
  );
}

function ParkCard({ id, ips }: { id: string; ips: { id: string; name: string }[] }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const park = w.player.ventures.parks.find((x) => x.id === id)!;
  const free = ips.filter((ip) => !park.lands.includes(ip.id));
  const [ipId, setIpId] = useState(free[0]?.id ?? '');
  const pick = free.some((ip) => ip.id === ipId) ? ipId : free[0]?.id ?? '';
  return (
    <Card title={park.name} subtitle={REGIONS[park.region].name} actions={<Badge tone={park.stage === 'open' ? 'good' : 'neutral'}>{park.stage === 'open' ? (w.day < park.closedUntil ? 'Closed for repairs' : 'Open') : `Opens ${date(park.openDay)}`}</Badge>}>
      {park.stage === 'building' ? (
        <Progress value={w.day - park.start} max={park.openDay - park.start} />
      ) : (
        <div className="space-y-1 text-sm">
          <Kv k="Visitors today" v={num(parkVisitors(w, park))} />
          <Kv k="Revenue (lifetime)" v={money(park.revenue)} />
        </div>
      )}
      <div className="mt-3">
        <div className="mb-1 text-xs font-medium text-sub">
          Themed lands ({park.lands.length}/{MAX_LANDS}) · each adds 25% more visitors
        </div>
        <div className="flex flex-wrap gap-1">
          {park.lands.map((l) => (
            <Badge key={l} tone="accent">
              {w.ips[l]?.name ?? 'Land'}
            </Badge>
          ))}
          {!park.lands.length && <span className="text-xs text-muted">No lands yet.</span>}
        </div>
        {park.lands.length < MAX_LANDS && free.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="Franchise for a new land" className={cx(inputClass, 'h-8 w-52 max-w-full text-xs')} value={pick} onChange={(e) => setIpId(e.target.value)}>
              {free.map((ip) => (
                <option key={ip.id} value={ip.id}>
                  {ip.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => act((world) => addLand(world, park.id, pick), 'New land added')}>
              Add land · {money(landCost(park))}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
