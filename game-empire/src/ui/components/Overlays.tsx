import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Award,
  Bell,
  BriefcaseBusiness,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Crown,
  Gamepad2,
  Globe,
  Inbox,
  Info,
  Landmark,
  Server,
  Skull,
  Sparkles,
  Target,
  TrendingUp,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { decisionOptionEnabled, resolveDecision } from '../../engine/events';
import { playerCompany } from '../../engine/util';
import { bankLegacy, legacyPointsFor } from '../../engine/legacy';
import type { DecisionEvent, NewsItem, Notice, NoticeCategory } from '../../engine/types';
import { date, money } from '../lib/format';
import { Button, Kv, Modal, cx } from './ui';

const CATEGORY_ICON: Record<NoticeCategory, (size: number) => ReactNode> = {
  studio: (s) => <BriefcaseBusiness size={s} />,
  game: (s) => <Gamepad2 size={s} />,
  team: (s) => <Users size={s} />,
  finance: (s) => <Landmark size={s} />,
  market: (s) => <TrendingUp size={s} />,
  industry: (s) => <Globe size={s} />,
  offer: (s) => <Sparkles size={s} />,
  achievement: (s) => <Award size={s} />,
  server: (s) => <Server size={s} />,
  goal: (s) => <Target size={s} />,
};

function toneIcon(tone: NewsItem['tone'], category: NoticeCategory | undefined, size: number): ReactNode {
  if (category && category !== 'studio') return CATEGORY_ICON[category](size);
  if (tone === 'good') return <CircleCheck size={size} />;
  if (tone === 'bad') return <CircleAlert size={size} />;
  return <Info size={size} />;
}

const toneColor = (tone: NewsItem['tone']) => (tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'major' ? 'text-warn' : 'text-accent');
const toneBar = (tone: NewsItem['tone']) => (tone === 'good' ? 'bg-good' : tone === 'bad' ? 'bg-bad' : tone === 'major' ? 'bg-warn' : 'bg-accent');

// ------------------------------------------------------------ toasts

/**
 * Small notifications in the top-right corner, one at a time, sitting in the
 * header bar beside the inbox and bell so they never cover buttons. They never
 * block or pause the game; everything stays in the history.
 */
export function Toasts() {
  const toasts = useGameStore((s) => s.toasts);
  const dismiss = useGameStore((s) => s.dismissToast);
  const hold = useGameStore((s) => s.holdToast);
  const start = useGameStore((s) => s.startToast);
  const follow = useGameStore((s) => s.follow);
  const openDrawer = useGameStore((s) => s.openDrawer);
  const drawer = useGameStore((s) => s.drawer);
  const [expanded, setExpanded] = useState(false);
  const leaving = toasts.find((t) => t.leaving);
  const waiting = toasts.filter((t) => !t.leaving);
  const head = leaving ?? waiting[0];
  const queued = waiting.length - (leaving ? 0 : 1);
  useEffect(() => {
    if (!toasts.length) return;
    const tick = () => {
      const list = useGameStore.getState().toasts;
      if (list.some((x) => x.leaving)) return;
      const cur = list[0];
      if (!cur) return;
      if (cur.at === 0) return start(cur.id);
      // move faster through a backlog
      const ttl = list.length > 1 && !cur.lead ? Math.min(cur.ttl, 2600) : cur.ttl;
      if (Date.now() - cur.at > ttl) dismiss(cur.id);
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [toasts.length, dismiss, start]);
  useEffect(() => setExpanded(false), [head?.id]);
  if (drawer || !head) return null;
  const ttl = queued > 0 && !head.lead ? Math.min(head.ttl, 2600) : head.ttl;
  return (
    <div
      className="pointer-events-none fixed left-[52px] right-2 z-[60] flex justify-end sm:left-auto sm:right-[84px]"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 7px)' }}
      aria-live="polite"
    >
      <div
        key={head.id}
        onMouseEnter={() => {
          hold(head.id, true);
          setExpanded(true);
        }}
        onMouseLeave={() => {
          hold(head.id, false);
          setExpanded(false);
        }}
        className={cx(
          'pointer-events-auto relative w-full overflow-hidden rounded-lg border border-line bg-surface-2/95 shadow-lg shadow-black/40 backdrop-blur sm:w-[340px]',
          head.leaving ? 'toast-out' : 'toast-in',
        )}
      >
        <button
          onClick={() => {
            if (head.link) follow(head.link);
            dismiss(head.id);
          }}
          className={cx('flex w-full items-start gap-2.5 px-3 py-2 pr-14 text-left', head.link && 'hover:bg-surface-3/60')}
          title={head.body ? `${head.title}\n${head.body}` : head.title}
        >
          <span className={cx('mt-0.5 shrink-0', toneColor(head.tone))}>{toneIcon(head.tone, head.category, 15)}</span>
          <span className="min-w-0 flex-1">
            <span className={cx('block text-[13px] font-medium leading-snug text-ink', !expanded && 'truncate')}>{head.title}</span>
            {head.body && <span className={cx('block text-[11px] leading-snug text-muted', !expanded && 'truncate')}>{head.body}</span>}
          </span>
        </button>
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
          {queued > 0 && (
            <button onClick={() => openDrawer('all')} className="rounded bg-surface-3 px-1.5 text-[10px] font-semibold text-sub hover:text-ink" title="More notifications: open history">
              +{queued}
            </button>
          )}
          <button onClick={() => dismiss(head.id)} className="rounded p-1 text-muted hover:text-ink" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
        {head.at > 0 && Number.isFinite(head.at) && !head.leaving && (
          <span className={cx('toast-timer absolute bottom-0 left-0 h-[2px] opacity-60', toneBar(head.tone))} style={{ animationDuration: `${Math.max(300, ttl - (Date.now() - head.at))}ms` }} />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ inbox

export function DecisionCard({ ev, compact }: { ev: DecisionEvent; compact?: boolean }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const left = ev.expiresDay - w.day;
  const fallback = ev.defaultOption ?? (ev.options.find((o) => o.id === 'decline' || o.id === 'settle') ?? ev.options[ev.options.length - 1])?.id;
  const fallbackLabel = ev.options.find((o) => o.id === fallback)?.label;
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-start gap-2">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug">{ev.title}</div>
          {!compact && <p className="mt-1 text-xs leading-relaxed text-sub">{ev.body}</p>}
        </div>
      </div>
      <div className={cx('mt-2.5 grid gap-1.5', compact ? 'grid-cols-1' : 'sm:grid-cols-1')}>
        {ev.options.map((o) => {
          // cost-gated options re-enable once you can afford them
          const disabled = !decisionOptionEnabled(w, ev, o.id);
          return (
            <button
              key={o.id}
              disabled={disabled}
              onClick={() => act((world) => resolveDecision(world, ev.id, o.id))}
              className="rounded-md border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-accent hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="text-xs font-semibold text-ink">{o.label}</div>
              {o.description && <div className="mt-0.5 text-[11px] leading-snug text-muted">{o.description}</div>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-muted">
        {left <= 7 ? <span className="text-warn">{Math.max(0, left)} days left</span> : `${left} days to decide`}
        {fallbackLabel && <> · if you do nothing: {fallbackLabel}</>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ notification centre

const FILTERS: { id: 'all' | NoticeCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'game', label: 'Games' },
  { id: 'server', label: 'Servers' },
  { id: 'studio', label: 'Studio' },
  { id: 'finance', label: 'Finance' },
  { id: 'industry', label: 'Industry' },
  { id: 'goal', label: 'Goals' },
  { id: 'offer', label: 'Offers' },
];

function ago(w: { day: number }, day: number): string {
  const d = w.day - day;
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return date(day);
}

export function unreadCount(notices: Notice[]): number {
  let n = 0;
  for (const x of notices) {
    if (x.read) break;
    n++;
  }
  return n;
}

export function NotificationDrawer() {
  const w = useWorld();
  const tab = useGameStore((s) => s.drawer);
  const open = useGameStore((s) => s.openDrawer);
  const follow = useGameStore((s) => s.follow);
  const bump = useGameStore((s) => s.bump);
  const [filter, setFilter] = useState<'all' | NoticeCategory>('all');
  useEffect(() => {
    if (!tab) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && open(null);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [tab, open]);
  const list = useMemo(() => (filter === 'all' ? w.notices : w.notices.filter((n) => n.category === filter)), [w.notices, filter, w.notices.length, w.notices[0]?.id]);
  if (!tab) return null;
  const pending = w.pendingEvents;
  return (
    <div className="fixed inset-0 z-[55]" onMouseDown={(e) => e.target === e.currentTarget && open(null)}>
      <div className="drawer-fade absolute inset-0 bg-black/40" onClick={() => open(null)} />
      <aside
        className="drawer-in absolute bottom-0 right-0 top-0 flex w-[420px] max-w-full flex-col border-l border-line bg-surface shadow-2xl"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
          <Bell size={16} className="text-accent" />
          <h2 className="flex-1 text-sm font-semibold">Notifications</h2>
          <button onClick={() => open(null)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="flex gap-1 border-b border-line-soft px-3 py-2">
          <DrawerTabButton active={tab === 'inbox'} onClick={() => open('inbox')} icon={<Inbox size={13} />} label="Inbox" count={pending.length} />
          <DrawerTabButton active={tab === 'all'} onClick={() => open('all')} icon={<Bell size={13} />} label="History" count={unreadCount(w.notices)} />
        </div>
        {tab === 'inbox' ? (
          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {pending.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-muted">
                <Inbox size={26} />
                Nothing needs your attention. Offers and dilemmas land here, and the game keeps running while you think.
              </div>
            ) : (
              pending.map((ev) => <DecisionCard key={ev.id} ev={ev} />)
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 border-b border-line-soft px-3 py-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cx('rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors', filter === f.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink')}
                >
                  {f.label}
                </button>
              ))}
              <div className="ml-auto flex gap-1">
                <button
                  title="Mark all as read"
                  onClick={() => {
                    for (const n of w.notices) n.read = true;
                    bump();
                  }}
                  className="rounded p-1 text-muted hover:text-ink"
                >
                  <CheckCheck size={14} />
                </button>
                <button
                  title="Clear history"
                  onClick={() => {
                    w.notices.length = 0;
                    bump();
                  }}
                  className="rounded p-1 text-muted hover:text-bad"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {list.length === 0 && <div className="px-6 py-16 text-center text-sm text-muted">No notifications yet.</div>}
              {list.slice(0, 150).map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    n.read = true;
                    if (n.link) follow(n.link);
                    else bump();
                  }}
                  className={cx('flex w-full items-start gap-2.5 border-b border-line-soft px-4 py-2.5 text-left transition-colors hover:bg-surface-2', !n.read && 'bg-accent-soft/20')}
                >
                  <span className={cx('mt-0.5 shrink-0', toneColor(n.tone))}>{toneIcon(n.tone, n.category, 14)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug text-ink">{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-xs leading-snug text-muted">{n.body}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">{ago(w, n.day)}</span>
                  {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function DrawerTabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cx('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', active ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink')}
    >
      {icon}
      {label}
      {count > 0 && <span className={cx('rounded-full px-1.5 text-[10px] font-semibold', label === 'Inbox' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}>{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

// ------------------------------------------------------------ game over

export function GameOverModal() {
  const w = useWorld();
  const quit = useGameStore((s) => s.quitToMenu);
  const go = w.player.gameOver;
  const [banked, setBanked] = useState(0);
  useEffect(() => {
    if (go && !w.player.legacyBanked) setBanked(bankLegacy(w));
  }, [go, w]);
  if (!go) return null;
  const c = playerCompany(w);
  const win = go.reason === 'sold' || go.reason === 'retired';
  const s = w.player.stats;
  const yearsPlayed = (go.day - c.founded) / 365;
  return (
    <Modal open title={win ? 'Exit achieved' : 'Game over'}>
      <div className="flex flex-col items-center text-center">
        <div className={cx('mb-3 flex h-14 w-14 items-center justify-center rounded-full', win ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad')}>
          {win ? <Crown size={28} /> : <Skull size={28} />}
        </div>
        <h3 className="text-lg font-semibold">{go.title}</h3>
        <p className="mt-1 text-sm text-sub">{go.body}</p>
      </div>
      <div className="mt-5 rounded-lg border border-line bg-surface-2 px-4 py-2">
        <Kv k="Final net worth" v={money(go.netWorth)} tone={go.netWorth > 0 ? 'good' : 'bad'} />
        <Kv k="Years in business" v={yearsPlayed.toFixed(1)} />
        <Kv k="Studio level" v={w.player.progression.level} />
        <Kv k="Games released" v={s.gamesReleased} />
        <Kv k="Best critic score" v={s.bestCritic || '—'} />
        <Kv k="Peak concurrent players" v={Math.round(s.peakCcu).toLocaleString()} />
        <Kv k="Lifetime revenue" v={money(c.revenueTotal)} />
        <Kv k="Peak valuation" v={money(s.peakValuation)} />
        <Kv k="Goals completed" v={w.player.objectivesCompleted} />
        <Kv k="Achievements" v={`${Object.keys(w.player.achievements).length}`} />
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft/30 px-4 py-2.5 text-sm">
        <Crown size={16} className="text-warn" />
        <span className="flex-1">Legacy points earned this run</span>
        <span className="font-semibold tabular text-warn">+{banked || legacyPointsFor(w)}</span>
      </div>
      <p className="mt-1.5 text-center text-xs text-muted">Spend them on head starts when you found your next studio.</p>
      <div className="mt-5 flex justify-center">
        <Button variant="primary" onClick={quit}>
          Back to main menu
        </Button>
      </div>
    </Modal>
  );
}
