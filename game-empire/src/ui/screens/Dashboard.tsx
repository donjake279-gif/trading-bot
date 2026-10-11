import { CircleCheck, Gamepad2, Plus, Rocket, TriangleAlert, Users, Wallet, X } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { playerCompany } from '../../engine/util';
import { monthlyBurn, revenueTTM } from '../../engine/finance';
import { dismissTutorial } from '../../engine/actions';
import { founderStake } from '../../engine/stocks';
import { GENRES, OFFICES } from '../../engine/constants';
import { aggregateHistory, companyActive, companyCcu, companyRev30, devGamesOf, liveGamesOf, runwayMonths } from '../lib/selectors';
import { date, money, num, pct } from '../lib/format';
import { TimeChart } from '../components/charts';
import { Badge, Button, Card, Empty, LiveNumber, Progress, ScoreBadge, Stat, cx } from '../components/ui';
import { NewsList } from './News';

function Checklist() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const c = playerCompany(w);
  const games = Object.values(w.games).filter((g) => g.companyId === c.id);
  const steps = [
    { done: games.length > 0, label: 'Start your first game', hint: 'Studio → New Game. A Tiny indie game is a safe first step.', go: () => navigate({ name: 'create' }) },
    { done: games.some((g) => g.status === 'released'), label: 'Release it', hint: 'When development hits 100%, polish a little and press Release.', go: () => navigate({ name: 'projects' }) },
    { done: w.player.employees.length > 1, label: 'Hire your first employee', hint: 'Team → Hiring. Watch your monthly payroll!', go: () => navigate({ name: 'team' }) },
    { done: games.some((g) => g.updates.length > 0), label: 'Ship an update to a live game', hint: 'Updates bring players back and fix bugs.', go: () => navigate({ name: 'projects' }) },
    { done: w.player.officeLevel > 0, label: 'Move out of the bedroom', hint: 'Office & R&D. A garage fits 5 people.', go: () => navigate({ name: 'office' }) },
    { done: w.player.research.completed.length > 0, label: 'Complete your first research', hint: 'R&D unlocks speed, quality and new tech.', go: () => navigate({ name: 'office' }) },
  ];
  const done = steps.filter((s) => s.done).length;
  if (w.player.tutorialDismissed || done === steps.length) return null;
  return (
    <Card
      title={`Getting started · ${done}/${steps.length}`}
      subtitle="Your first steps toward an empire. Press Space to pause/resume, 1–4 to change speed."
      actions={
        <button onClick={() => act(dismissTutorial)} className="rounded p-1 text-muted hover:text-ink" aria-label="Dismiss">
          <X size={16} />
        </button>
      }
    >
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((s) => (
          <button key={s.label} onClick={s.go} className={cx('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors', s.done ? 'border-good/30 bg-good-soft/40' : 'border-line bg-surface-2 hover:border-accent')}>
            <CircleCheck size={16} className={cx('mt-0.5 shrink-0', s.done ? 'text-good' : 'text-muted')} />
            <div>
              <div className={cx('text-sm font-medium', s.done ? 'text-sub line-through' : 'text-ink')}>{s.label}</div>
              {!s.done && <div className="text-xs text-muted">{s.hint}</div>}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function Alerts() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const c = playerCompany(w);
  const alerts: { tone: 'bad' | 'warn' | 'good'; text: string; go?: () => void }[] = [];
  const runway = runwayMonths(w, c);
  if (runway < 3 && c.cash > 0) alerts.push({ tone: 'warn', text: `Cash runway is about ${runway.toFixed(1)} months at the current burn rate.`, go: () => navigate({ name: 'finance' }) });
  const ready = devGamesOf(w, c.id).filter((g) => g.workDone >= g.workRequired);
  for (const g of ready) alerts.push({ tone: 'good', text: `${g.title} is feature-complete. Polish removes bugs; release when ready.`, go: () => navigate({ name: 'game', id: g.id }) });
  const idle = w.player.employees.filter((e) => !e.assignment && !['marketing', 'community'].includes(e.role));
  if (idle.length > 0 && !w.player.autoAssign) alerts.push({ tone: 'warn', text: `${idle.length} developer${idle.length > 1 ? 's are' : ' is'} idle (still on payroll).`, go: () => navigate({ name: 'team' }) });
  const unstaffed = devGamesOf(w, c.id).filter((g) => !w.player.employees.some((e) => e.assignment === g.id));
  for (const g of unstaffed) alerts.push({ tone: 'warn', text: `${g.title} has no team assigned — development is stalled.`, go: () => navigate({ name: 'game', id: g.id }) });
  if (founderStake(c) < 0.5 && c.boardConfidence < 40) alerts.push({ tone: 'bad', text: `Board confidence is ${Math.round(c.boardConfidence)}%. Below 15% you may be fired.`, go: () => navigate({ name: 'finance' }) });
  if (w.player.employees.length > OFFICES[w.player.officeLevel].capacity) alerts.push({ tone: 'bad', text: 'Your office is overcrowded — morale is suffering.', go: () => navigate({ name: 'office' }) });
  const bleeding = liveGamesOf(w, c.id).filter((g) => g.cost30 > g.rev30 * 1.2 && g.cost30 > 300 && w.day - (g.releaseDay ?? 0) > 60);
  for (const g of bleeding) alerts.push({ tone: 'warn', text: `${g.title}'s servers cost more than it earns.`, go: () => navigate({ name: 'game', id: g.id }) });
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {alerts.slice(0, 5).map((a, i) => (
        <button
          key={i}
          onClick={a.go}
          className={cx(
            'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm',
            a.tone === 'bad' ? 'border-bad/40 bg-bad-soft text-bad' : a.tone === 'warn' ? 'border-warn/30 bg-warn-soft/60 text-warn' : 'border-good/30 bg-good-soft/50 text-good',
          )}
        >
          {a.tone === 'good' ? <Rocket size={15} /> : <TriangleAlert size={15} />}
          <span className="flex-1">{a.text}</span>
        </button>
      ))}
    </div>
  );
}

export function Dashboard() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const c = playerCompany(w);
  const live = liveGamesOf(w, c.id).sort((a, b) => b.ccu - a.ccu);
  const devs = devGamesOf(w, c.id);
  const ccu = companyCcu(w, c.id);
  const rev30 = companyRev30(w, c.id);
  const burn = monthlyBurn(w, c);
  const mine = Object.values(w.games).filter((g) => g.companyId === c.id);
  const ccuHistory = aggregateHistory(mine, 2, w.day - 180);
  const playerNews = w.news.filter((n) => n.kind === 'player' || n.companyId === c.id).slice(0, 6);
  const industryNews = w.news.filter((n) => n.kind !== 'player' && n.companyId !== c.id).slice(0, 8);

  return (
    <div className="space-y-4">
      <Alerts />
      <Checklist />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Players online" icon={<span className="live-dot" style={{ width: 6, height: 6 }} />} value={<LiveNumber value={ccu} format={(n) => Math.round(n).toLocaleString()} />} sub={`${num(companyActive(w, c.id))} active players`} />
        <Stat label="Cash" icon={<Wallet size={13} />} value={money(c.cash)} tone={c.cash < 0 ? 'bad' : undefined} sub={Number.isFinite(runwayMonths(w, c)) ? `${runwayMonths(w, c).toFixed(1)} mo runway` : 'Cash-flow positive'} />
        <Stat label="Revenue (30d)" value={money(rev30)} tone={rev30 > 0 ? 'good' : undefined} sub={`TTM ${money(revenueTTM(c))}`} />
        <Stat label="Costs (monthly)" value={money(burn)} sub={`Net ${money(rev30 - burn)}/mo`} tone={rev30 - burn < 0 ? 'warn' : undefined} />
        <Stat label="Valuation" value={money(c.isPublic ? c.price * c.shares : c.valuation)} sub={`You own ${pct(founderStake(c), founderStake(c) < 1 ? 1 : 0)}`} />
        <Stat label="Employees" icon={<Users size={13} />} value={w.player.employees.length} sub={`${OFFICES[w.player.officeLevel].name} · cap ${OFFICES[w.player.officeLevel].capacity}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Players online across your games" subtitle="Concurrent players, last 180 days">
          {ccuHistory.length > 1 ? (
            <TimeChart series={[{ key: 'ccu', name: 'Players online', color: '#3987e5', data: ccuHistory }]} format={(n) => num(n)} height={230} />
          ) : (
            <Empty icon={<Gamepad2 size={28} />} title="No players yet">
              Release your first game and this chart comes alive.
            </Empty>
          )}
        </Card>
        <Card title="Cash" subtitle="Company bank balance">
          <TimeChart series={[{ key: 'cash', name: 'Cash', color: '#199e70', data: c.cashHistory.filter((p) => p[0] >= w.day - 365) }]} format={(n) => money(n)} height={230} yDomain={['auto', 'auto']} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Live games" subtitle="Click a game to manage it" actions={<Button size="sm" variant="primary" onClick={() => navigate({ name: 'create' })}><Plus size={14} /> New game</Button>} pad={false}>
          {live.length === 0 ? (
            <div className="p-4">
              <Empty title="Nothing on the market yet">Your released games will appear here with live player counts.</Empty>
            </div>
          ) : (
            <div className="divide-y divide-line-soft">
              {live.slice(0, 7).map((g) => (
                <button key={g.id} onClick={() => navigate({ name: 'game', id: g.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                  <ScoreBadge score={g.criticScore} label="Critic score" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{g.title}</div>
                    <div className="text-xs text-muted">
                      {GENRES[g.genre].name} · {money(g.rev30)}/30d {g.update && <Badge tone="accent" className="ml-1">updating</Badge>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1.5 text-sm font-semibold">
                      <span className="live-dot" style={{ width: 6, height: 6 }} />
                      <LiveNumber value={g.ccu} format={(n) => Math.round(n).toLocaleString()} />
                    </div>
                    <div className="text-[11px] text-muted">online</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card title="In development" actions={<Button size="sm" onClick={() => navigate({ name: 'projects' })}>Studio</Button>}>
          {devs.length === 0 ? (
            <Empty title="No projects in development">
              <Button size="sm" variant="primary" className="mt-2" onClick={() => navigate({ name: 'create' })}>
                <Plus size={14} /> Start a game
              </Button>
            </Empty>
          ) : (
            <div className="space-y-3">
              {devs.map((g) => {
                const team = w.player.employees.filter((e) => e.assignment === g.id).length;
                return (
                  <button key={g.id} onClick={() => navigate({ name: 'game', id: g.id })} className="block w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-left hover:border-accent">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{g.title}</span>
                      <span className="tabular text-sub">{Math.min(100, Math.round((g.workDone / g.workRequired) * 100))}%</span>
                    </div>
                    <Progress value={g.workDone} max={g.workRequired} tone={g.workDone >= g.workRequired ? 'good' : 'accent'} className="mt-2" />
                    <div className="mt-1.5 flex justify-between text-xs text-muted">
                      <span>
                        {GENRES[g.genre].name} · team {team} · hype {Math.round(g.hype)}
                      </span>
                      <span>started {date(g.createdDay)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Your studio" subtitle="Latest company news">
          <NewsList items={playerNews} compact />
        </Card>
        <Card title="Industry wire" actions={<Button size="sm" variant="ghost" onClick={() => navigate({ name: 'news' })}>All news</Button>}>
          <NewsList items={industryNews} compact />
        </Card>
      </div>
    </div>
  );
}
