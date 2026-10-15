// Small building blocks shared by the Dominion screens.
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useGameStore, useWorld } from '../../../store/gameStore';
import { FEATURES, featureOpen, type DominionFeature } from '../../../engine/dominionCore';
import { EMPIRE_LEVELS } from '../../../engine/empire';
import { CORP_PERSONAS } from '../../../engine/corpLines';
import type { Megacorp } from '../../../engine/types';
import { money } from '../../lib/format';
import { Card, cx } from '../../components/ui';

export function useAct() {
  return useGameStore((s) => s.act);
}

/** Shows the children once the feature is open, otherwise how to unlock it. */
export function FeatureGate({ f, children }: { f: DominionFeature; children: ReactNode }) {
  const w = useWorld();
  if (featureOpen(w, f)) return <>{children}</>;
  const def = FEATURES[f];
  const lvl = EMPIRE_LEVELS[def.level];
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Lock size={18} className="mt-0.5 shrink-0 text-muted" />
        <div>
          <div className="text-sm font-semibold">{def.name} is locked</div>
          <p className="mt-1 text-sm text-sub">{def.blurb}</p>
          <p className="mt-2 text-sm text-warn">
            Unlocks at empire level {def.level}, {lvl.name}: a company worth {money(lvl.min)}.
          </p>
        </div>
      </div>
    </Card>
  );
}

/** A labelled bar, 0..max. */
export function Meter({ label, value, max = 100, tone = 'accent', right }: { label: ReactNode; value: number; max?: number; tone?: 'good' | 'bad' | 'warn' | 'accent' | 'neutral'; right?: ReactNode }) {
  const p = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const bar = { good: 'bg-good', bad: 'bg-bad', warn: 'bg-warn', accent: 'bg-accent', neutral: 'bg-sub' }[tone];
  return (
    <div>
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular text-sub">{right ?? Math.round(value)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className={cx('h-full rounded-full transition-[width] duration-300', bar)} style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  );
}

/** -100..100 around a centre line: red to the left, green to the right. */
export function CenterBar({ value, height = 6, className }: { value: number; height?: number; className?: string }) {
  const v = Math.max(-100, Math.min(100, value));
  return (
    <div className={cx('relative w-full overflow-hidden rounded-full bg-surface-3', className)} style={{ height }}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
      {v >= 0 ? <div className="absolute inset-y-0 left-1/2 rounded-r-full bg-good" style={{ width: `${v / 2}%` }} /> : <div className="absolute inset-y-0 rounded-l-full bg-bad" style={{ right: '50%', width: `${-v / 2}%` }} />}
    </div>
  );
}

export function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`Level ${level} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cx('h-1.5 w-3 rounded-full', i < level ? 'bg-accent' : 'bg-surface-3')} />
      ))}
    </span>
  );
}

export function CorpAvatar({ c, size = 36 }: { c: Megacorp; size?: number }) {
  const persona = CORP_PERSONAS[c.persona];
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: `${c.color}33`, fontSize: size * 0.48 }} title={`${persona.name}: ${persona.blurb}`}>
      {persona.emoji}
    </div>
  );
}

export function relationLabel(r: number): { text: string; tone: 'good' | 'bad' | 'warn' | 'neutral' } {
  if (r >= 50) return { text: 'Friendly', tone: 'good' };
  if (r >= 15) return { text: 'Warm', tone: 'good' };
  if (r > -15) return { text: 'Neutral', tone: 'neutral' };
  if (r > -50) return { text: 'Cold', tone: 'warn' };
  return { text: 'Hostile', tone: 'bad' };
}

export function toneText(tone: 'good' | 'bad' | 'neutral' | 'major' | 'warn'): string {
  return tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'major' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-sub';
}

/** A little "label: value" stat block used across the Dominion. */
export function Mini({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cx('text-sm font-semibold tabular', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</div>
    </div>
  );
}
