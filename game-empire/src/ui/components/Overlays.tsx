import { useEffect } from 'react';
import { CircleAlert, CircleCheck, Crown, Info, Skull, Sparkles } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { resolveDecision } from '../../engine/events';
import { playerCompany } from '../../engine/util';
import { date, money } from '../lib/format';
import { Button, Kv, Modal, cx } from './ui';

export function Toasts() {
  const toasts = useGameStore((s) => s.toasts);
  const dismiss = useGameStore((s) => s.dismissToast);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setInterval(() => {
      const now = Date.now();
      for (const x of useGameStore.getState().toasts) if (now - x.at > 4500) dismiss(x.id);
    }, 500);
    return () => clearInterval(t);
  }, [toasts.length, dismiss]);
  return (
    <div className="pointer-events-none fixed right-4 z-[60] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            'toast-in pointer-events-auto flex cursor-pointer items-start gap-2.5 rounded-lg border bg-surface-2 px-3 py-2.5 text-sm shadow-xl',
            t.tone === 'good' ? 'border-good/40' : t.tone === 'bad' ? 'border-bad/40' : t.tone === 'major' ? 'border-accent/40' : 'border-line',
          )}
        >
          <span className={cx('mt-0.5', t.tone === 'good' ? 'text-good' : t.tone === 'bad' ? 'text-bad' : 'text-accent')}>
            {t.tone === 'good' ? <CircleCheck size={16} /> : t.tone === 'bad' ? <CircleAlert size={16} /> : <Info size={16} />}
          </span>
          <span className="text-ink">{t.title}</span>
        </div>
      ))}
    </div>
  );
}

export function DecisionModal() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const ev = w.pendingEvents[0];
  if (!ev || w.player.gameOver) return null;
  return (
    <Modal open title={<span className="flex items-center gap-2"><Sparkles size={18} className="text-warn" />{ev.title}</span>}>
      <p className="text-sm leading-relaxed text-sub">{ev.body}</p>
      <div className="mt-2 text-xs text-muted">Decide by {date(ev.expiresDay)} — the game is paused until you choose.</div>
      <div className="mt-4 space-y-2">
        {ev.options.map((o) => (
          <button
            key={o.id}
            disabled={o.disabled}
            onClick={() => act((world) => resolveDecision(world, ev.id, o.id))}
            className="block w-full rounded-lg border border-line bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="text-sm font-semibold text-ink">{o.label}</div>
            <div className="mt-0.5 text-xs text-muted">{o.description}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function GameOverModal() {
  const w = useWorld();
  const quit = useGameStore((s) => s.quitToMenu);
  const go = w.player.gameOver;
  if (!go) return null;
  const c = playerCompany(w);
  const win = go.reason === 'sold';
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
        <Kv k="Games released" v={s.gamesReleased} />
        <Kv k="Best critic score" v={s.bestCritic || '—'} />
        <Kv k="Peak concurrent players" v={Math.round(s.peakCcu).toLocaleString()} />
        <Kv k="Lifetime revenue" v={money(c.revenueTotal)} />
        <Kv k="Peak valuation" v={money(s.peakValuation)} />
        <Kv k="Achievements" v={`${Object.keys(w.player.achievements).length}`} />
      </div>
      <div className="mt-5 flex justify-center">
        <Button variant="primary" onClick={quit}>
          Back to main menu
        </Button>
      </div>
    </Modal>
  );
}
