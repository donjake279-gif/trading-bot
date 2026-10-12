import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, Dices, Lock, Minus, Rocket, TriangleAlert } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import {
  ART_STYLES,
  ART_STYLE_IDS,
  AUDIENCES,
  AUDIENCE_IDS,
  ENGINES,
  ENGINE_IDS,
  FOCUS_IDS,
  FOCUS_LABELS,
  GENRES,
  GENRE_IDS,
  MONETIZATIONS,
  MONETIZATION_IDS,
  MULTIPLAYER,
  MULTIPLAYER_IDS,
  SERVER_TIERS,
  PLATFORMS,
  PLATFORM_IDS,
  RESEARCH,
  ROLES,
  SCOPES,
  SCOPE_IDS,
  focus as mkFocus,
} from '../../engine/constants';
import {
  engineStats,
  estimateWork,
  fitScores,
  hasResearch,
  memberOutput,
  recommendedBudget,
  teamFactors,
  upfrontCosts,
  type GameParams,
} from '../../engine/development';
import { createGame, validateGameParams } from '../../engine/actions';
import { audiencePool, genreTrend } from '../../engine/market';
import { gameTitle, sequelTitle } from '../../engine/names';
import { infraCapacity } from '../../engine/infra';
import { playerCompany } from '../../engine/util';
import type { Employee, Focus, FocusId, Game } from '../../engine/types';
import { days, money, num, pct } from '../lib/format';
import { Badge, Button, Card, Field, Kv, Progress, SectionTitle, cx, inputClass } from '../components/ui';

type Step = 0 | 1 | 2 | 3;
const STEPS = ['Concept', 'Platforms & tech', 'Business', 'Team & focus'];

function fitLabel(f: number): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (f >= 1.12) return { label: 'Great fit', tone: 'good' };
  if (f >= 1.0) return { label: 'Good fit', tone: 'good' };
  if (f >= 0.85) return { label: 'OK', tone: 'neutral' };
  if (f >= 0.6) return { label: 'Poor fit', tone: 'warn' };
  return { label: 'Terrible fit', tone: 'bad' };
}

function FitBadge({ f }: { f: number }) {
  const l = fitLabel(f);
  return <Badge tone={l.tone}>{l.label}</Badge>;
}

function Choice({ active, disabled, onClick, children, className }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface-2 hover:border-sub',
        className,
      )}
    >
      {children}
    </button>
  );
}

function defaultParams(w: ReturnType<typeof useWorld>, ipId?: string): GameParams {
  const c = playerCompany(w);
  const staff = w.player.employees.filter((e) => ROLES[e.role].dev).length;
  const scope = staff <= 2 ? 'tiny' : staff <= 6 ? 'small' : staff <= 20 ? 'medium' : staff <= 70 ? 'large' : 'aaa';
  const base: GameParams = {
    title: gameTitle({ rng: (w.day * 7919 + w.nextId) >>> 0 }, 'indie'),
    genre: 'indie',
    platforms: ['pc'],
    audience: 'casual',
    engine: 'pixelforge',
    monetization: 'premium',
    price: SCOPES[scope].price,
    artStyle: 'pixel',
    multiplayer: 'single',
    scope,
    budget: 0,
    focus: mkFocus(1, 1, 1, 1, 1, 1),
  };
  if (ipId && w.ips[ipId]) {
    const ip = w.ips[ipId];
    const last = ip.games.map((id) => w.games[id]).filter(Boolean).sort((a, b) => b.createdDay - a.createdDay)[0];
    if (last) {
      Object.assign(base, {
        genre: last.genre,
        platforms: last.platforms.filter((p) => c.reputation >= PLATFORMS[p].minRep),
        audience: last.audience,
        engine: last.engine,
        monetization: last.monetization,
        price: last.price || SCOPES[last.scope].price,
        artStyle: last.artStyle,
        multiplayer: last.multiplayer,
        scope: last.scope,
        focus: { ...last.focus },
        ipId,
        title: sequelTitle({ rng: (w.day * 31 + w.nextId) >>> 0 }, ip.name, ip.games.length + 1),
      });
      if (base.platforms.length === 0) base.platforms = ['pc'];
    }
  }
  base.budget = Math.round(recommendedBudget(base.scope, base.artStyle, base.platforms) / 100) * 100;
  return base;
}

/** Set one dimension's share and scale the others so the total stays 100%. */
export function rebalanceFocus(f: Focus, d: FocusId, share: number): Focus {
  const s = Math.max(0, Math.min(1, share));
  const total = FOCUS_IDS.reduce((acc, k) => acc + f[k], 0) || 1;
  const othersTotal = FOCUS_IDS.reduce((acc, k) => (k === d ? acc : acc + f[k] / total), 0);
  const next = { ...f };
  for (const k of FOCUS_IDS) {
    if (k === d) next[k] = s;
    else next[k] = othersTotal > 0 ? ((f[k] / total) / othersTotal) * (1 - s) : (1 - s) / (FOCUS_IDS.length - 1);
  }
  return next;
}

/** Project each focus dimension's coverage (1.0 = on target) for a team. */
export function projectCoverage(w: ReturnType<typeof useWorld>, p: GameParams, team: Employee[]) {
  const temp = { scope: p.scope, focus: p.focus, crunch: false } as Game;
  const { teamEff, producerBoost } = teamFactors(team, p.scope);
  let totalWork = 0;
  const pts: Record<FocusId, number> = { gameplay: 0, graphics: 0, story: 0, audio: 0, tech: 0, content: 0 };
  for (const e of team) {
    const out = memberOutput(w, e, temp.focus, false, teamEff, producerBoost);
    totalWork += out.work;
    for (const d of FOCUS_IDS) pts[d] += out.work * out.alloc[d] * out.quality;
  }
  const ideal = GENRES[p.genre].ideal;
  const cov: Record<FocusId, number> = { gameplay: 0, graphics: 0, story: 0, audio: 0, tech: 0, content: 0 };
  for (const d of FOCUS_IDS) cov[d] = totalWork > 0 ? pts[d] / totalWork / ideal[d] : 0;
  return { cov, dailyWork: totalWork };
}

export function CreateGame({ ipId }: { ipId?: string }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const c = playerCompany(w);
  const [step, setStep] = useState<Step>(0);
  const [p, setP] = useState<GameParams>(() => defaultParams(w, ipId));
  const devStaff = w.player.employees.filter((e) => ROLES[e.role].dev);
  const [teamIds, setTeamIds] = useState<string[]>(() => devStaff.filter((e) => !e.assignment).map((e) => e.id));
  const team = devStaff.filter((e) => teamIds.includes(e.id));
  const set = (patch: Partial<GameParams>) => setP((prev) => ({ ...prev, ...patch }));
  const analytics = hasResearch(w, 'analytics');

  const work = estimateWork(w, p, true);
  const { cov, dailyWork } = useMemo(() => projectCoverage(w, p, team), [w, p, team]);
  const estDays = dailyWork > 0 ? work / dailyWork : Infinity;
  const payroll = team.reduce((s, e) => s + e.salary, 0);
  const upfront = upfrontCosts(w, p, true);
  const rec = recommendedBudget(p.scope, p.artStyle, p.platforms);
  const totalCost = upfront + p.budget + (Number.isFinite(estDays) ? (payroll * estDays) / 30 : 0);
  const fits = fitScores(p);
  const error = validateGameParams(w, p);
  const pool = audiencePool(w, p);
  const eng = engineStats(w, p.engine, true);

  const warnings: string[] = [];
  if (team.length === 0) warnings.push('No developers assigned — the project will not progress.');
  const sameGenre = Object.values(w.games).filter((g) => g.companyId === c.id && g.genre === p.genre && g.releaseDay !== null && w.day - g.releaseDay < 240).length;
  if (sameGenre >= 1) warnings.push(`You shipped ${sameGenre} ${GENRES[p.genre].name} game${sameGenre > 1 ? 's' : ''} recently. Critics punish "more of the same" after the second.`);
  if (GENRES[p.genre].mp[p.multiplayer] < 0.5) warnings.push(`${GENRES[p.genre].name} games are expected to be ${p.genre === 'mmorpg' ? 'massively multiplayer' : 'online multiplayer'}.`);
  if (Number.isFinite(estDays) && estDays > 700) warnings.push(`At this team size development takes ${days(estDays)}. Hire more people or reduce scope.`);
  if (totalCost > c.cash * 1.2 && totalCost > 5000) warnings.push(`Estimated total cost ${money(totalCost)} exceeds your cash. You will need revenue or financing.`);
  if (p.audience === 'kids' && p.monetization === 'f2pAggressive') warnings.push('Loot boxes aimed at kids invite scandals.');
  if (p.multiplayer === 'online' || p.multiplayer === 'massive') {
    const cap = infraCapacity(w);
    warnings.push(`Online games run on your own servers (${SERVER_TIERS[w.player.infra.tier].name}, room for ${num(cap)} players${w.player.infra.autoscale ? ', autoscaling on' : ''}). A busy launch can overload them: check Servers before release.`);
  }
  if (p.monetization === 'subscription' && p.genre !== 'mmorpg') warnings.push('Players only accept subscriptions for MMORPGs.');
  if (p.monetization === 'ads' && !p.platforms.includes('mobile')) warnings.push('Ad-supported games really only work on mobile.');
  if (!MONETIZATIONS[p.monetization].upfront && p.multiplayer === 'single') warnings.push('Free-to-play single-player games struggle to monetize.');
  if (p.engine === 'pixelforge' && (p.artStyle === 'realistic' || p.artStyle === 'photoreal')) warnings.push('PixelForge is a 2D engine: realistic art will look poor.');
  if (MONETIZATIONS[p.monetization].upfront && p.price > SCOPES[p.scope].price * 1.6) warnings.push(`Players expect around $${SCOPES[p.scope].price} for a ${SCOPES[p.scope].name} game.`);

  const submit = () => {
    const res = act((world) => createGame(world, p, teamIds), `Development started on ${p.title}`);
    if (res.ok && res.id) navigate({ name: 'game', id: res.id });
  };

  const competition = (gid: string) =>
    Object.values(w.games).filter((g) => g.genre === gid && ((g.status === 'released' && w.day - (g.releaseDay ?? 0) < 365) || g.status === 'development')).length;

  return (
    <div>
      <SectionTitle actions={<Button variant="ghost" onClick={() => navigate({ name: 'projects' })}>Cancel</Button>}>
        {p.ipId ? `New sequel: ${w.ips[p.ipId]?.name}` : 'Create a new game'}
      </SectionTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i as Step)}
            className={cx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', step === i ? 'border-accent bg-accent-soft/50 text-ink' : 'border-line bg-surface text-sub hover:text-ink')}
          >
            <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold', step > i ? 'bg-good text-white' : step === i ? 'bg-accent text-white' : 'bg-surface-3')}>
              {step > i ? <Check size={12} /> : i + 1}
            </span>
            {s}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {step === 0 && (
            <>
              <Card title="Title">
                <div className="flex gap-2">
                  <input className={inputClass} value={p.title} onChange={(e) => set({ title: e.target.value })} maxLength={48} />
                  <Button onClick={() => set({ title: gameTitle({ rng: (Date.now() & 0xffffffff) >>> 0 }, p.genre) })} title="Random title">
                    <Dices size={15} />
                  </Button>
                </div>
              </Card>
              <Card title="Genre" subtitle="Trend shows current player interest. Competition counts recent and upcoming releases.">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {GENRE_IDS.map((gid) => {
                    const t = genreTrend(w, gid);
                    const xp = c.genreXp[gid] ?? 0;
                    return (
                      <Choice key={gid} active={p.genre === gid} onClick={() => set({ genre: gid })}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{GENRES[gid].name}</span>
                          <span className={cx('flex items-center text-xs tabular', t > 1.08 ? 'text-good' : t < 0.92 ? 'text-bad' : 'text-sub')}>
                            {t > 1.08 ? <ArrowUpRight size={13} /> : t < 0.92 ? <ArrowDownRight size={13} /> : <Minus size={13} />}
                            {Math.round(t * 100)}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted">{GENRES[gid].blurb}</div>
                        <div className="mt-1.5 flex gap-2 text-[11px] text-sub">
                          <span>{competition(gid)} competing</span>
                          {xp > 0 && <span className="text-good">exp {xp.toFixed(1)}</span>}
                          <span className="ml-auto">min {SCOPES[GENRES[gid].minScope].name.split(' ')[0]}</span>
                        </div>
                      </Choice>
                    );
                  })}
                </div>
              </Card>
              <Card title="Target audience">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {AUDIENCE_IDS.map((a) => {
                    const f = fitScores({ ...p, audience: a }).audience;
                    return (
                      <Choice key={a} active={p.audience === a} onClick={() => set({ audience: a })}>
                        <div className="text-sm font-semibold">{AUDIENCES[a].name}</div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                          <span>spend ×{AUDIENCES[a].spend}</span>
                          <FitBadge f={f} />
                        </div>
                      </Choice>
                    );
                  })}
                </div>
              </Card>
            </>
          )}

          {step === 1 && (
            <>
              <Card title="Platforms" subtitle="Each extra platform adds work but widens your audience.">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {PLATFORM_IDS.map((pl) => {
                    const def = PLATFORMS[pl];
                    const locked = c.reputation < def.minRep;
                    const on = p.platforms.includes(pl);
                    const aff = def.affinity[p.genre] ?? 1;
                    return (
                      <Choice
                        key={pl}
                        active={on}
                        disabled={locked}
                        onClick={() => set({ platforms: on ? p.platforms.filter((x) => x !== pl) : [...p.platforms, pl] })}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{def.name}</span>
                          {locked ? <span className="flex items-center gap-1 text-[11px] text-warn"><Lock size={11} /> rep {def.minRep}</span> : on ? <Check size={15} className="text-accent" /> : null}
                        </div>
                        <div className="mt-1 text-[11px] text-muted">{def.blurb}</div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-sub">
                          <span>{num(w.market.platforms[pl].users * 1e6)} users</span>
                          <span>+{pct(w.market.platforms[pl].growth)}/yr</span>
                          {def.devKit > 0 && <span>kit {money(def.devKit)}</span>}
                        </div>
                        <div className="mt-1"><FitBadge f={aff} /></div>
                      </Choice>
                    );
                  })}
                </div>
              </Card>
              <Card title="Engine">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ENGINE_IDS.map((e) => {
                    const def = ENGINES[e];
                    const stats = engineStats(w, e, true);
                    const lockedRes = def.research && !hasResearch(w, def.research);
                    const lockedRep = c.reputation < def.minRep;
                    return (
                      <Choice key={e} active={p.engine === e} disabled={!!lockedRes || lockedRep} onClick={() => set({ engine: e })}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{def.name}</span>
                          {(lockedRes || lockedRep) && <Lock size={12} className="text-warn" />}
                        </div>
                        <div className="mt-1 text-[11px] text-muted">{def.blurb}</div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-sub">
                          <span>quality cap {stats.cap}</span>
                          <span>speed ×{(1 / stats.workMult).toFixed(2)}</span>
                          {stats.licenseCost > 0 && <span>{money(stats.licenseCost)}</span>}
                          {stats.royalty > 0 && <span>{pct(stats.royalty)} royalty</span>}
                        </div>
                        {lockedRes && <div className="mt-1 text-[11px] text-warn">Requires {RESEARCH[def.research!].name}</div>}
                        {lockedRep && <div className="mt-1 text-[11px] text-warn">Requires reputation {def.minRep}</div>}
                      </Choice>
                    );
                  })}
                </div>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Multiplayer">
                  <div className="grid gap-2">
                    {MULTIPLAYER_IDS.map((m) => (
                      <Choice key={m} active={p.multiplayer === m} onClick={() => set({ multiplayer: m })}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{MULTIPLAYER[m].name}</span>
                          <FitBadge f={GENRES[p.genre].mp[m]} />
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          work ×{MULTIPLAYER[m].workMult} {MULTIPLAYER[m].serverBase > 0 ? '· runs on your servers · lower churn' : '· no servers · faster churn'}
                        </div>
                      </Choice>
                    ))}
                  </div>
                </Card>
                <Card title="Art style">
                  <div className="grid grid-cols-2 gap-2">
                    {ART_STYLE_IDS.map((a) => (
                      <Choice key={a} active={p.artStyle === a} onClick={() => set({ artStyle: a })}>
                        <div className="text-sm font-semibold">{ART_STYLES[a].name}</div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted">
                          <span>cost ×{ART_STYLES[a].costMult}</span>
                          <FitBadge f={fitScores({ ...p, artStyle: a }).art} />
                        </div>
                      </Choice>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Card title="Scope" subtitle="Bigger games need bigger teams and budgets, but get far more attention.">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {SCOPE_IDS.map((s) => {
                    const wk = estimateWork(w, { ...p, scope: s }, true);
                    const d = dailyWork > 0 ? wk / dailyWork : Infinity;
                    const tooSmall = SCOPE_IDS.indexOf(s) < SCOPE_IDS.indexOf(GENRES[p.genre].minScope);
                    return (
                      <Choice
                        key={s}
                        active={p.scope === s}
                        onClick={() => set({ scope: s, price: MONETIZATIONS[p.monetization].upfront ? SCOPES[s].price : 0, budget: Math.round(recommendedBudget(s, p.artStyle, p.platforms) / 100) * 100 })}
                      >
                        <div className="text-sm font-semibold">{SCOPES[s].name}</div>
                        <div className="mt-1 text-[11px] text-muted">
                          team ~{SCOPES[s].typicalTeam} · budget ~{money(recommendedBudget(s, p.artStyle, p.platforms))}
                        </div>
                        <div className={cx('mt-0.5 text-[11px]', d > 700 ? 'text-bad' : 'text-sub')}>{Number.isFinite(d) ? `≈ ${days(d)} with this team` : 'no team selected'}</div>
                        {tooSmall && <div className="mt-0.5 text-[11px] text-warn">Too small for {GENRES[p.genre].name}</div>}
                      </Choice>
                    );
                  })}
                </div>
              </Card>
              <Card title="Business model">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {MONETIZATION_IDS.map((m) => (
                    <Choice key={m} active={p.monetization === m} onClick={() => set({ monetization: m, price: MONETIZATIONS[m].upfront ? p.price || SCOPES[p.scope].price : 0 })}>
                      <div className="text-sm font-semibold">{MONETIZATIONS[m].name}</div>
                      <div className="mt-1 text-[11px] text-muted">{MONETIZATIONS[m].blurb}</div>
                    </Choice>
                  ))}
                </div>
                {MONETIZATIONS[p.monetization].upfront && (
                  <div className="mt-4 max-w-xs">
                    <Field label="Price" hint={`players expect ~$${SCOPES[p.scope].price}`}>
                      <input type="number" min={0.99} max={99.99} step={1} className={inputClass} value={p.price} onChange={(e) => set({ price: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
              </Card>
              <Card title="Development budget" subtitle="Spent gradually on assets, outsourcing and tools. More budget = higher production values (with diminishing returns).">
                <div className="flex flex-wrap items-center gap-4">
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.05}
                    value={Math.min(4, p.budget / Math.max(1, rec))}
                    onChange={(e) => set({ budget: Math.round((Number(e.target.value) * rec) / 100) * 100 })}
                    className="min-w-[220px] flex-1"
                  />
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular">{money(p.budget)}</div>
                    <div className="text-xs text-muted">{(p.budget / Math.max(1, rec)).toFixed(2)}× recommended ({money(rec)})</div>
                  </div>
                </div>
              </Card>
            </>
          )}

          {step === 3 && (
            <>
              <Card
                title="Team"
                subtitle="Only developers work on projects. Selecting someone busy moves them to this game."
                actions={
                  <>
                    <Button size="sm" onClick={() => setTeamIds(devStaff.map((e) => e.id))}>Everyone</Button>
                    <Button size="sm" onClick={() => setTeamIds(devStaff.filter((e) => !e.assignment).map((e) => e.id))}>Idle only</Button>
                    <Button size="sm" variant="ghost" onClick={() => setTeamIds([])}>None</Button>
                  </>
                }
              >
                {devStaff.length === 0 ? (
                  <div className="text-sm text-muted">No developers. Hire some in Team.</div>
                ) : (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {devStaff.map((e) => {
                      const on = teamIds.includes(e.id);
                      const busy = e.assignment ? w.games[e.assignment] : null;
                      return (
                        <button
                          key={e.id}
                          onClick={() => setTeamIds(on ? teamIds.filter((x) => x !== e.id) : [...teamIds, e.id])}
                          className={cx('flex items-center gap-3 rounded-lg border px-3 py-2 text-left', on ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2 hover:border-sub')}
                        >
                          <span className={cx('flex h-4 w-4 items-center justify-center rounded border', on ? 'border-accent bg-accent text-white' : 'border-line')}>{on && <Check size={11} />}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{e.name}</div>
                            <div className="text-[11px] text-muted">
                              {e.isFounder ? `Founder (${e.specialty})` : ROLES[e.role].name} · skill {Math.round(e.skill)}
                              {busy && <span className="text-warn"> · on {busy.title}</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
              <Card
                title="Development focus"
                subtitle={analytics ? 'Targets come from Player Analytics. Coverage shows what your team will actually produce.' : 'Stars show how much the genre values each area. Research Player Analytics for exact targets.'}
              >
                <div className="space-y-3">
                  {FOCUS_IDS.map((d) => {
                    const ideal = GENRES[p.genre].ideal[d];
                    const total = FOCUS_IDS.reduce((s, k) => s + p.focus[k], 0);
                    const share = p.focus[d] / Math.max(1e-6, total);
                    const coverage = cov[d];
                    return (
                      <div key={d} className="grid grid-cols-[110px_1fr_120px] items-center gap-3">
                        <div>
                          <div className="text-sm">{FOCUS_LABELS[d]}</div>
                          <div className="text-[11px] text-warn">{analytics ? `target ${pct(ideal)}` : '★'.repeat(ideal >= 0.25 ? 3 : ideal >= 0.14 ? 2 : 1)}</div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(share * 100)}
                          onChange={(e) => set({ focus: rebalanceFocus(p.focus, d, Number(e.target.value) / 100) })}
                        />
                        <div>
                          <div className="flex justify-between text-[11px] text-muted">
                            <span>effort {pct(share)}</span>
                            <span className={coverage >= 0.95 ? 'text-good' : coverage >= 0.7 ? 'text-warn' : 'text-bad'}>{team.length ? `${Math.round(coverage * 100)}%` : '—'}</span>
                          </div>
                          <Progress value={Math.min(1.3, coverage)} max={1.3} tone={coverage >= 0.95 ? 'good' : coverage >= 0.7 ? 'warn' : 'bad'} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => set({ focus: mkFocus(1, 1, 1, 1, 1, 1) })}>Balanced</Button>
                  {analytics && <Button size="sm" onClick={() => set({ focus: { ...GENRES[p.genre].ideal } })}>Match genre targets</Button>}
                </div>
                <p className="mt-3 text-xs text-muted">
                  Coverage below 100% means the team lacks the right roles (e.g. no artists → weak graphics). Sliders shift effort for people with several skills.
                </p>
              </Card>
            </>
          )}

          <div className="flex justify-between">
            <Button disabled={step === 0} onClick={() => setStep((step - 1) as Step)}>
              <ChevronLeft size={15} /> Back
            </Button>
            {step < 3 ? (
              <Button variant="primary" onClick={() => setStep((step + 1) as Step)}>
                Next <ChevronRight size={15} />
              </Button>
            ) : (
              <Button variant="primary" disabled={!!error} onClick={submit}>
                <Rocket size={15} /> Start development
              </Button>
            )}
          </div>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card title="Project summary">
            <div className="text-base font-semibold">{p.title || 'Untitled'}</div>
            <div className="mb-3 text-xs text-muted">
              {SCOPES[p.scope].name} {GENRES[p.genre].name} · {AUDIENCES[p.audience].name} · {p.platforms.map((x) => PLATFORMS[x].name).join(', ') || 'no platform'}
            </div>
            <Kv k="Work required" v={`${num(work)} pts`} />
            <Kv k="Team" v={`${team.length} (${num(dailyWork, 1)} pts/day)`} />
            <Kv k="Est. development" v={Number.isFinite(estDays) ? days(estDays) : '∞'} tone={estDays > 700 ? 'bad' : undefined} />
            <Kv k="Payroll during dev" v={`${money(payroll)}/mo`} />
            <Kv k="Licenses & dev kits" v={money(upfront)} />
            <Kv k="Budget" v={money(p.budget)} />
            <div className="my-2 border-t border-line-soft" />
            <Kv k="Est. total cost" v={money(totalCost)} tone={totalCost > c.cash ? 'warn' : undefined} />
            <Kv k="Your cash" v={money(c.cash)} />
            <Kv k="Addressable players" v={num(pool)} />
            <Kv k="Quality ceiling" v={eng.cap} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-[11px] text-muted">Audience</span> <FitBadge f={fits.audience} />
              <span className="text-[11px] text-muted">Art</span> <FitBadge f={fits.art} />
              <span className="text-[11px] text-muted">Mode</span> <FitBadge f={fits.multiplayer} />
              <span className="text-[11px] text-muted">Platforms</span> <FitBadge f={fits.platform} />
            </div>
            {(warnings.length > 0 || error) && (
              <div className="mt-3 space-y-1.5">
                {error && <div className="flex gap-1.5 rounded-md bg-bad-soft px-2 py-1.5 text-xs text-bad"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{error}</div>}
                {warnings.map((x) => (
                  <div key={x} className="flex gap-1.5 rounded-md bg-warn-soft/70 px-2 py-1.5 text-xs text-warn">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                    {x}
                  </div>
                ))}
              </div>
            )}
            <Button variant="primary" className="mt-4 w-full" disabled={!!error} onClick={submit}>
              <Rocket size={15} /> Start development
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
