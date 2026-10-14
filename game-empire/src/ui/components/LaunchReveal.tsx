import { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Rocket, Sparkles, Swords, Trophy } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { GENRES, SCOPES } from '../../engine/constants';
import { criticReviews, topicLabel } from '../../engine/reviews';
import { legendaryCombo } from '../../engine/topics';
import { nemesis, rivalRecord } from '../../engine/rivalry';
import type { LaunchNote } from '../../engine/types';
import { Button, Modal, ScoreBadge, cx } from './ui';

const REVIEW_MS = 650;
const COUNT_MS = 900;

function verdict(score: number): string {
  if (score >= 95) return 'Masterpiece';
  if (score >= 90) return 'Universal acclaim';
  if (score >= 80) return 'Great reviews';
  if (score >= 70) return 'Good reviews';
  if (score >= 55) return 'Mixed reviews';
  if (score >= 40) return 'Poor reviews';
  return 'A critical mauling';
}

function scoreColor(score: number): string {
  return score >= 75 ? 'text-good' : score >= 55 ? 'text-warn' : 'text-bad';
}

/** Launch day: critic reviews land one by one, then the score. The game waits while you watch. */
export function LaunchReveal() {
  const launches = useGameStore((s) => s.launches);
  const note = launches[0];
  if (!note) return null;
  return <Reveal key={note.gameId} note={note} />;
}

function Reveal({ note }: { note: LaunchNote }) {
  const w = useWorld();
  const dismiss = useGameStore((s) => s.dismissLaunch);
  const navigate = useGameStore((s) => s.navigate);
  const g = w.games[note.gameId];
  const reviews = useMemo(() => (g ? [...criticReviews(g, 5)].sort((a, b) => a.score - b.score) : []), [g]);
  const [shown, setShown] = useState(0);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const resume = useRef(false);

  // the game waits while the reviews come in
  useEffect(() => {
    const s = useGameStore.getState();
    if (!s.paused) {
      resume.current = true;
      s.setPaused(true);
    }
  }, []);

  useEffect(() => {
    if (!g || done) return;
    if (shown < reviews.length) {
      const t = setTimeout(() => setShown((n) => n + 1), REVIEW_MS);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / COUNT_MS);
      setScore(Math.round(g.criticScore * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else setDone(true);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [g, shown, done, reviews.length]);

  // a great score gets confetti once it lands
  useEffect(() => {
    if (!done || !g || g.criticScore < 85) return;
    const st = useGameStore.getState();
    useGameStore.setState({ celebrations: [...st.celebrations, { id: `launch-${g.id}`, title: `${g.criticScore}/100!`, big: g.criticScore >= 92 }].slice(-2) });
  }, [done, g]);

  useEffect(() => {
    if (!g) dismiss();
  }, [g, dismiss]);
  if (!g) return null;

  const finish = () => {
    setShown(reviews.length);
    setScore(g.criticScore);
    setDone(true);
  };
  const close = (open?: boolean) => {
    const more = useGameStore.getState().launches.length > 1;
    dismiss();
    if (open) navigate({ name: 'game', id: g.id });
    if (resume.current && !more) useGameStore.getState().setPaused(false);
  };

  const record = note.prevBest > 0 && g.criticScore > note.prevBest;
  const combo = g.topic ? legendaryCombo(g.genre, g.topic) : null;
  const rival = nemesis(w);
  const rec = rival ? rivalRecord(w, rival.id) : null;

  return (
    <Modal
      open
      onClose={() => close()}
      title={
        <span className="flex items-center gap-2">
          <Rocket size={16} className="text-accent" /> Launch day: {g.title}
        </span>
      }
      footer={
        done ? (
          <>
            <Button variant="ghost" onClick={() => close(true)}>
              See the game
            </Button>
            <Button variant="primary" onClick={() => close()}>
              Continue
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={finish}>
            Skip to the score
          </Button>
        )
      }
    >
      <div className="text-xs text-muted">
        {SCOPES[g.scope].name} {GENRES[g.genre].name}
        {g.topic && ` · ${topicLabel(g)}`}
      </div>
      <div className="mt-3 space-y-2">
        {reviews.map((r, i) => (
          <div
            key={r.outlet}
            className={cx('flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 transition-all duration-300', i < shown ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0')}
          >
            <ScoreBadge score={r.score} />
            <div className="min-w-0">
              <div className="text-xs font-semibold">{r.outlet}</div>
              <div className="text-xs italic text-sub">"{r.quote}"</div>
            </div>
          </div>
        ))}
      </div>
      <div className={cx('mt-4 text-center transition-opacity duration-300', shown >= reviews.length ? 'opacity-100' : 'opacity-0')}>
        <div className="text-xs uppercase tracking-wide text-muted">Critic score</div>
        <div className={cx('text-6xl font-black tabular', scoreColor(score))}>{score}</div>
        <div className={cx('mt-1 text-sm font-semibold', done ? scoreColor(g.criticScore) : 'text-transparent')}>{verdict(g.criticScore)}</div>
      </div>
      {done && (
        <div className="mt-3 space-y-1.5 text-sm">
          {record && (
            <div className="flex items-center gap-2 text-good">
              <Trophy size={14} /> New studio record! (best was {note.prevBest})
            </div>
          )}
          {g.breakout > 1 && (
            <div className="flex items-center gap-2 text-good">
              <Flame size={14} /> Breakout hit: word of mouth is exploding.
            </div>
          )}
          {combo && (
            <div className="flex items-center gap-2 text-accent">
              <Sparkles size={14} /> Legendary combo: {combo.pitch}
            </div>
          )}
          {note.rivalLine && (
            <div className="mt-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-sub">
                <Swords size={12} /> Your rival reacts{rec && ` · rivalry ${rec.won}–${rec.lost}`}
              </div>
              <div className="mt-0.5 italic text-ink">{note.rivalLine}</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
