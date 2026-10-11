import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  ChartCandlestick,
  FlaskConical,
  Gamepad2,
  Globe,
  Landmark,
  LayoutDashboard,
  Menu,
  Newspaper,
  Pause,
  Play,
  Settings,
  Star,
  Swords,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { SPEEDS, useGameStore, useWorld, type Route } from '../../store/gameStore';
import { playerCompany } from '../../engine/util';
import { founderStake } from '../../engine/stocks';
import { formatDate } from '../../engine/util';
import { PLAYER_GRACE_DAYS } from '../../engine/constants';
import { money, pct } from '../lib/format';
import { cx } from './ui';

const NAV: { route: Route['name']; label: string; icon: ReactNode }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
  { route: 'projects', label: 'Studio', icon: <Gamepad2 size={17} /> },
  { route: 'team', label: 'Team', icon: <Users size={17} /> },
  { route: 'office', label: 'Office & R&D', icon: <FlaskConical size={17} /> },
  { route: 'industry', label: 'Industry', icon: <Globe size={17} /> },
  { route: 'competitors', label: 'Competitors', icon: <Swords size={17} /> },
  { route: 'stocks', label: 'Stock Market', icon: <ChartCandlestick size={17} /> },
  { route: 'finance', label: 'Finance', icon: <Landmark size={17} /> },
  { route: 'news', label: 'News', icon: <Newspaper size={17} /> },
  { route: 'achievements', label: 'Achievements', icon: <Trophy size={17} /> },
  { route: 'settings', label: 'Game & Saves', icon: <Settings size={17} /> },
];

const ROUTE_GROUP: Partial<Record<Route['name'], Route['name']>> = { create: 'projects', game: 'projects', company: 'competitors' };

function NavList({ onPick }: { onPick?: () => void }) {
  const w = useWorld();
  const route = useGameStore((s) => s.route);
  const navigate = useGameStore((s) => s.navigate);
  const active = ROUTE_GROUP[route.name] ?? route.name;
  const devCount = Object.values(w.games).filter((g) => g.companyId === w.player.companyId && g.status === 'development').length;
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((n) => (
        <button
          key={n.route}
          onClick={() => {
            navigate({ name: n.route } as Route);
            onPick?.();
          }}
          className={cx(
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            active === n.route ? 'bg-surface-3 text-ink' : 'text-sub hover:bg-surface-2 hover:text-ink',
          )}
        >
          <span className={active === n.route ? 'text-accent' : ''}>{n.icon}</span>
          <span className="flex-1 text-left">{n.label}</span>
          {n.route === 'projects' && devCount > 0 && <span className="rounded bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">{devCount}</span>}
        </button>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
        <svg viewBox="0 0 64 64" width="20" height="20">
          <path d="M14 44l10-24 8 15 7-10 11 19z" fill="white" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-bold tracking-tight">Game Empire</div>
        <div className="text-[10px] uppercase tracking-widest text-muted">Tycoon</div>
      </div>
    </div>
  );
}

function SpeedControls() {
  const speed = useGameStore((s) => s.speed);
  const paused = useGameStore((s) => s.paused);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const togglePause = useGameStore((s) => s.togglePause);
  const w = useWorld();
  const blocked = w.pendingEvents.length > 0 || !!w.player.gameOver;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) setSpeed(Number(e.code.slice(5)) - 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [togglePause, setSpeed]);
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 p-1" title="Space: pause · 1-4: speed">
      <button
        onClick={togglePause}
        disabled={blocked}
        className={cx('flex h-7 w-7 items-center justify-center rounded-md', paused ? 'bg-warn-soft text-warn' : 'text-sub hover:text-ink', blocked && 'opacity-40')}
        aria-label={paused ? 'Resume' : 'Pause'}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
      {SPEEDS.map((s, i) => (
        <button
          key={s.label}
          disabled={blocked}
          onClick={() => setSpeed(i)}
          className={cx('h-7 rounded-md px-2 text-xs font-semibold tabular', !paused && speed === i ? 'bg-accent text-white' : 'text-sub hover:text-ink', blocked && 'opacity-40')}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const w = useWorld();
  const c = playerCompany(w);
  const navigate = useGameStore((s) => s.navigate);
  const paused = useGameStore((s) => s.paused);
  const prevCash = c.cashHistory.length > 1 ? c.cashHistory[c.cashHistory.length - 2][1] : c.cash;
  const delta = c.cash - prevCash;
  return (
    <header className="sticky z-30 border-b border-line bg-bg/90 backdrop-blur" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <button onClick={onMenu} className="rounded-md p-1.5 text-sub hover:bg-surface-2 lg:hidden" aria-label="Menu">
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{c.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted tabular">
            {!paused && <span className="live-dot" style={{ width: 6, height: 6 }} />}
            {formatDate(w.day, true)}
          </div>
        </div>
        <SpeedControls />
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
          <TopStat label="Cash" value={money(c.cash)} tone={c.cash < 0 ? 'text-bad' : 'text-ink'} sub={delta !== 0 ? `${delta > 0 ? '+' : ''}${money(delta)}/day` : undefined} subTone={delta >= 0 ? 'text-good' : 'text-bad'} />
          <TopStat label="Valuation" value={money(c.isPublic ? c.price * c.shares : c.valuation)} />
          <TopStat label="Your stake" value={pct(founderStake(c), founderStake(c) < 1 ? 1 : 0)} tone={founderStake(c) < 0.5 ? 'text-warn' : 'text-ink'} />
          <div className="hidden sm:block">
            <div className="text-[10px] uppercase tracking-wide text-muted">Reputation</div>
            <div className="flex items-center gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={12} className={c.reputation >= (i + 1) * 20 - 10 ? 'fill-warn text-warn' : 'text-line'} />
              ))}
              <span className="ml-1 text-xs tabular text-sub">{Math.round(c.reputation)}</span>
            </div>
          </div>
          <button onClick={() => navigate({ name: 'news' })} className="relative rounded-md p-1.5 text-sub hover:bg-surface-2 hover:text-ink" aria-label="News">
            <Bell size={17} />
            {w.pendingEvents.length > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-bad" />}
          </button>
        </div>
      </div>
      {c.cash < 0 && !w.player.gameOver && (
        <div className="border-t border-bad/40 bg-bad-soft px-4 py-1.5 text-xs font-medium text-bad">
          Cash is negative: {Math.max(0, PLAYER_GRACE_DAYS - c.insolventDays)} days until bankruptcy. Take a loan, raise money, sell shares or cut costs.
          <button onClick={() => navigate({ name: 'finance' })} className="ml-2 underline">Open Finance</button>
        </div>
      )}
    </header>
  );
}

function TopStat({ label, value, tone = 'text-ink', sub, subTone }: { label: string; value: string; tone?: string; sub?: string; subTone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={cx('text-sm font-semibold tabular', tone)}>
        {value}
        {sub && <span className={cx('ml-1.5 text-[11px] font-normal', subTone)}>{sub}</span>}
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-full lg:pl-[220px]">
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col gap-5 border-r border-line bg-surface px-3 lg:flex"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <Brand />
        <NavList />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside
            className="flex h-full w-[240px] flex-col gap-5 border-r border-line bg-surface px-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-sub" aria-label="Close menu">
                <X size={18} />
              </button>
            </div>
            <NavList onPick={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <TopBar onMenu={() => setOpen(true)} />
      <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
    </div>
  );
}
