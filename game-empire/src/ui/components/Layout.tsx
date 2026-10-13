import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  Cpu,
  Inbox,
  Server,
  Target,
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
import { PLAYER_GRACE_DAYS, xpForLevel } from '../../engine/constants';
import { fleetDown, isOnline } from '../../engine/infra';
import { readyForVersion } from '../../engine/studioEngine';
import { money, pct } from '../lib/format';
import { unreadCount } from './Overlays';
import { cx } from './ui';

const NAV: { route: Route['name']; label: string; icon: ReactNode }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
  { route: 'projects', label: 'Studio', icon: <Gamepad2 size={17} /> },
  { route: 'team', label: 'Team', icon: <Users size={17} /> },
  { route: 'office', label: 'Office & R&D', icon: <FlaskConical size={17} /> },
  { route: 'engine', label: 'Engine', icon: <Cpu size={17} /> },
  { route: 'servers', label: 'Servers', icon: <Server size={17} /> },
  { route: 'goals', label: 'Goals & Perks', icon: <Target size={17} /> },
  { route: 'industry', label: 'Industry', icon: <Globe size={17} /> },
  { route: 'competitors', label: 'Competitors', icon: <Swords size={17} /> },
  { route: 'stocks', label: 'Stock Market', icon: <ChartCandlestick size={17} /> },
  { route: 'finance', label: 'Finance', icon: <Landmark size={17} /> },
  { route: 'news', label: 'News', icon: <Newspaper size={17} /> },
  { route: 'achievements', label: 'Trophy Room', icon: <Trophy size={17} /> },
  { route: 'settings', label: 'Game & Saves', icon: <Settings size={17} /> },
];

const ROUTE_GROUP: Partial<Record<Route['name'], Route['name']>> = { create: 'projects', game: 'projects', company: 'competitors' };

function NavList({ onPick }: { onPick?: () => void }) {
  const w = useWorld();
  const route = useGameStore((s) => s.route);
  const navigate = useGameStore((s) => s.navigate);
  const active = ROUTE_GROUP[route.name] ?? route.name;
  const mine = Object.values(w.games).filter((g) => g.companyId === w.player.companyId);
  const devCount = mine.filter((g) => g.status === 'development').length + w.player.contracts.length;
  const infra = w.player.infra;
  const serverAlert = (infra.load > 1 || fleetDown(w) || infra.dataCenters.some((d) => w.day >= d.readyDay && w.day < d.offlineUntil)) && mine.some((g) => g.status === 'released' && isOnline(g));
  const perkPoints = w.player.progression.perkPoints;
  const engineAlert = w.player.engine ? readyForVersion(w.player.engine) : w.player.research.completed.includes('engine1');
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
          {n.route === 'servers' && serverAlert && <span className="h-2 w-2 rounded-full bg-bad" title="Servers need attention" />}
          {n.route === 'engine' && engineAlert && <span className="h-2 w-2 rounded-full bg-good" title={w.player.engine ? 'Ready to ship a new version' : 'Ready to found your engine'} />}
          {n.route === 'goals' && perkPoints > 0 && <span className="rounded bg-good-soft px-1.5 text-[10px] font-semibold text-good" title="Unspent perk points">{perkPoints}</span>}
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
  const blocked = !!w.player.gameOver;
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

function LevelPill() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const pr = w.player.progression;
  const need = xpForLevel(pr.level);
  return (
    <button onClick={() => navigate({ name: 'goals' })} className="hidden items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1 sm:flex" title={`${Math.round(pr.xp)} / ${need} XP to level ${pr.level + 1}`}>
      <span className="text-xs font-semibold text-accent">Lv {pr.level}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min(100, (pr.xp / need) * 100)}%` }} />
      </span>
      {pr.perkPoints > 0 && <span className="rounded bg-good-soft px-1 text-[10px] font-semibold text-good">+{pr.perkPoints}</span>}
    </button>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const w = useWorld();
  const c = playerCompany(w);
  const navigate = useGameStore((s) => s.navigate);
  const paused = useGameStore((s) => s.paused);
  const openDrawer = useGameStore((s) => s.openDrawer);
  const unread = unreadCount(w.notices);
  const inbox = w.pendingEvents.length;
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
        <LevelPill />
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
          <div className="flex items-center gap-0.5">
            <button onClick={() => openDrawer('inbox')} className="relative rounded-md p-1.5 text-sub hover:bg-surface-2 hover:text-ink" aria-label={`Inbox (${inbox})`} title="Inbox: offers and decisions">
              <Inbox size={17} />
              {inbox > 0 && <span key={inbox} className="pop absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[9px] font-bold text-bg">{inbox}</span>}
            </button>
            <button onClick={() => openDrawer('all')} className="relative rounded-md p-1.5 text-sub hover:bg-surface-2 hover:text-ink" aria-label={`Notifications (${unread} unread)`} title="Notification history">
              <Bell size={17} />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
            </button>
          </div>
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
