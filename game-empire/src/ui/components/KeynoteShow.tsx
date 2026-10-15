import { useEffect, useRef, useState } from 'react';
import { Mic, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { VENUES, REVEAL_LABELS } from '../../engine/keynotes';
import type { KeynoteResult } from '../../engine/types';
import { money, num, pct } from '../lib/format';
import { Badge, Button, Modal, ScoreBadge, cx } from './ui';

const ITEM_MS = 1100;
const COUNT_MS = 900;

function scoreColor(score: number): string {
  return score >= 70 ? 'text-good' : score >= 50 ? 'text-warn' : 'text-bad';
}

function verdict(score: number): string {
  if (score >= 85) return 'A legendary keynote';
  if (score >= 70) return 'The world is talking';
  if (score >= 55) return 'A solid show';
  if (score >= 40) return 'Lukewarm';
  return 'A flop';
}

/** Your keynote, live: reveals land one by one, then the verdict and the rivals' reactions. */
export function KeynoteShow() {
  const shows = useGameStore((s) => s.keynoteShows);
  const launches = useGameStore((s) => s.launches.length);
  const show = shows[0];
  // launch reviews go first
  if (!show || launches > 0) return null;
  return <Show key={show.id} r={show} />;
}

function Show({ r }: { r: KeynoteResult }) {
  const dismiss = useGameStore((s) => s.dismissKeynote);
  const [shown, setShown] = useState(0);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const resume = useRef(false);

  useEffect(() => {
    const s = useGameStore.getState();
    if (!s.paused) {
      resume.current = true;
      s.setPaused(true);
    }
  }, []);

  useEffect(() => {
    if (done) return;
    if (shown < r.items.length) {
      const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 500 : ITEM_MS);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / COUNT_MS);
      setScore(Math.round(r.score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else setDone(true);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [r, shown, done]);

  const finish = () => {
    setShown(r.items.length);
    setScore(r.score);
    setDone(true);
  };
  const close = (open?: boolean) => {
    const more = useGameStore.getState().keynoteShows.length > 1;
    dismiss();
    if (open) useGameStore.getState().navigate({ name: 'dominion', tab: 'keynotes' });
    if (resume.current && !more) useGameStore.getState().setPaused(false);
  };

  return (
    <Modal
      open
      onClose={() => close()}
      title={
        <span className="flex items-center gap-2">
          <Mic size={16} className="text-accent" /> {r.title}
        </span>
      }
      footer={
        done ? (
          <>
            <Button variant="ghost" onClick={() => close(true)}>
              Keynotes
            </Button>
            <Button variant="primary" onClick={() => close()}>
              Continue
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={finish}>
            Skip to the verdict
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {VENUES[r.venue]?.name ?? 'Keynote'}
        {r.leaked && <Badge tone="warn">Leaked beforehand</Badge>}
        {r.clash && <Badge tone="warn">Same week as {r.clash}</Badge>}
      </div>
      <div className="mt-3 space-y-2">
        {r.items.map((it, i) => (
          <div
            key={i}
            className={cx(
              'flex items-start gap-3 rounded-lg border bg-surface-2 px-3 py-2 transition-all duration-300',
              it.surprise ? 'border-accent/60' : 'border-line',
              i < shown ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0',
            )}
          >
            <ScoreBadge score={it.score} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                {it.surprise && (
                  <span className="flex items-center gap-1 text-accent">
                    <Sparkles size={12} /> One more thing:
                  </span>
                )}
                {REVEAL_LABELS[it.kind]}: {it.label}
              </div>
              <div className="text-xs italic text-sub">{it.reaction}</div>
            </div>
          </div>
        ))}
      </div>
      <div className={cx('mt-4 text-center transition-opacity duration-300', shown >= r.items.length ? 'opacity-100' : 'opacity-0')}>
        <div className="text-xs uppercase tracking-wide text-muted">Audience score</div>
        <div className={cx('text-6xl font-black tabular', scoreColor(score))}>{score}</div>
        <div className={cx('mt-1 text-sm font-semibold', done ? scoreColor(r.score) : 'text-transparent')}>{verdict(r.score)}</div>
      </div>
      {done && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
              <div className="text-muted">Stock</div>
              <div className={cx('flex items-center gap-1 font-semibold tabular', r.stockMove >= 0 ? 'text-good' : 'text-bad')}>
                {r.stockMove >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {r.stockMove >= 0 ? '+' : ''}
                {pct(r.stockMove, 1)}
              </div>
            </div>
            <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
              <div className="text-muted">Reputation</div>
              <div className={cx('font-semibold tabular', r.rep >= 0 ? 'text-good' : 'text-bad')}>
                {r.rep >= 0 ? '+' : ''}
                {r.rep.toFixed(1)}
              </div>
            </div>
            <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
              <div className="text-muted">Game hype</div>
              <div className="font-semibold tabular">+{num(r.hype)}</div>
            </div>
            <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
              <div className="text-muted">Preorders</div>
              <div className="font-semibold tabular">{r.preorders > 0 ? money(r.preorders) : '—'}</div>
            </div>
          </div>
          {r.reactions.length > 0 && (
            <div className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs">
              <div className="font-semibold text-sub">The rivals react</div>
              <ul className="mt-1 space-y-1">
                {r.reactions.map((x) => (
                  <li key={x.corpId}>
                    <span className="font-medium text-ink">{x.name}</span> <span className="italic text-sub">{x.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
