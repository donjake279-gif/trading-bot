import { useEffect, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';

const COLORS = ['#3987e5', '#e0a526', '#2fbf71', '#d55181', '#9085e9', '#e66767', '#ffffff'];

function Burst({ id, title, big }: { id: string; title: string; big?: boolean }) {
  const clear = useGameStore((s) => s.clearCelebration);
  const pieces = useMemo(() => {
    const n = big ? 90 : 50;
    let seed = 0;
    for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return Array.from({ length: n }, (_, i) => ({
      key: i,
      left: rnd() * 100,
      delay: rnd() * 0.5,
      duration: 1.6 + rnd() * 1.4,
      drift: (rnd() - 0.5) * 160,
      spin: (rnd() - 0.5) * 900,
      size: 6 + rnd() * 7,
      color: COLORS[Math.floor(rnd() * COLORS.length)],
      round: rnd() > 0.6,
    }));
  }, [id, big]);
  useEffect(() => {
    const t = setTimeout(() => clear(id), big ? 4200 : 3200);
    return () => clearTimeout(t);
  }, [id, big, clear]);
  return (
    <>
      {pieces.map((p) => (
        <span
          key={p.key}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              background: p.color,
              borderRadius: p.round ? '50%' : 2,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
      <div className={big ? 'celebration-banner celebration-banner-big' : 'celebration-banner'}>{title}</div>
    </>
  );
}

/** Confetti for big moments. Never blocks clicks and never pauses the game. */
export function Confetti() {
  const celebrations = useGameStore((s) => s.celebrations);
  if (!celebrations.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      {celebrations.map((c) => (
        <Burst key={c.id} id={c.id} title={c.title} big={c.big} />
      ))}
    </div>
  );
}
