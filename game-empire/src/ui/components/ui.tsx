import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { scoreTone } from '../lib/format';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

type Tone = 'good' | 'bad' | 'warn' | 'neutral' | 'accent' | 'major';

const toneText: Record<Tone, string> = {
  good: 'text-good',
  bad: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-sub',
  accent: 'text-accent',
  major: 'text-accent',
};

const toneBadge: Record<Tone, string> = {
  good: 'bg-good-soft text-good border-good/30',
  bad: 'bg-bad-soft text-bad border-bad/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  neutral: 'bg-surface-3 text-sub border-line',
  accent: 'bg-accent-soft text-accent border-accent/30',
  major: 'bg-accent-soft text-accent border-accent/30',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium', toneBadge[tone], className)}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rounded-xl border border-line bg-surface px-4 py-3', className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cx('mt-1 text-xl font-semibold tabular', tone ? toneText[tone] : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  title,
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'good';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const v = {
    primary: 'bg-accent text-white hover:bg-[#4b95ec] border-accent',
    secondary: 'bg-surface-2 text-ink hover:bg-surface-3 border-line',
    ghost: 'bg-transparent text-sub hover:bg-surface-2 hover:text-ink border-transparent',
    danger: 'bg-bad-soft text-bad hover:bg-[#561f20] border-bad/40',
    good: 'bg-good-soft text-good hover:bg-[#174a32] border-good/40',
  }[variant];
  const s = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm', lg: 'h-11 px-5 text-base' }[size];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        v,
        s,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Progress({ value, max = 1, tone = 'accent', className, height = 6 }: { value: number; max?: number; tone?: Tone; className?: string; height?: number }) {
  const p = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const bg = { good: 'bg-good', bad: 'bg-bad', warn: 'bg-warn', neutral: 'bg-sub', accent: 'bg-accent', major: 'bg-accent' }[tone];
  const track = { good: 'bg-good-soft', bad: 'bg-bad-soft', warn: 'bg-warn-soft', neutral: 'bg-surface-3', accent: 'bg-accent-soft', major: 'bg-accent-soft' }[tone];
  return (
    <div className={cx('w-full overflow-hidden rounded-full', track, className)} style={{ height }}>
      <div className={cx('h-full rounded-full transition-[width] duration-300', bg)} style={{ width: `${p * 100}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', value === t.id ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose?: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open || !onClose) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('max-h-[90vh] w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {onClose && (
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="max-h-[calc(90vh-120px)] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ScoreBadge({ score, label }: { score: number; label?: string }) {
  const tone = scoreTone(score);
  return (
    <span
      title={label}
      className={cx(
        'inline-flex h-7 min-w-9 items-center justify-center rounded-md px-1.5 text-sm font-bold tabular',
        tone === 'good' ? 'bg-good-soft text-good' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad',
      )}
    >
      {Math.round(score)}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div className="text-sm font-medium text-sub">{title}</div>
      {children && <div className="max-w-md text-xs text-muted">{children}</div>}
    </div>
  );
}

export function CompanyDot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />;
}

/** A number that animates toward its target and jitters slightly while live. */
export function LiveNumber({ value, format, live = true }: { value: number; format: (n: number) => string; live?: boolean }) {
  const [shown, setShown] = useState(value);
  const target = useRef(value);
  const paused = useGameStore((s) => s.paused);
  target.current = value;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let wobble = 0;
    let nextWobble = 0;
    const step = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (live && !paused && t > nextWobble) {
        wobble = (Math.random() - 0.5) * 0.006;
        nextWobble = t + 500 + Math.random() * 700;
      }
      setShown((s) => {
        const goal = target.current * (1 + (paused ? 0 : wobble));
        const next = s + (goal - s) * Math.min(1, dt * 6);
        return Math.abs(next - goal) < 0.5 ? goal : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [live, paused]);
  return <span className="tabular">{format(shown)}</span>;
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-sub">{label}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent';

export function Kv({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{k}</span>
      <span className={cx('text-right font-medium tabular', tone ? toneText[tone] : 'text-ink')}>{v}</span>
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{children}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Delta({ value, format, invert }: { value: number; format: (n: number) => string; invert?: boolean }) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return <span className="text-muted">—</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  return <span className={good ? 'text-good' : 'text-bad'}>{up ? '▲' : '▼'} {format(Math.abs(value))}</span>;
}

export function Th({ children, className, onClick, active }: { children?: ReactNode; className?: string; onClick?: () => void; active?: boolean }) {
  return (
    <th
      onClick={onClick}
      className={cx('whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted', onClick && 'cursor-pointer select-none hover:text-ink', active && 'text-ink', className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('whitespace-nowrap px-3 py-2 text-sm', className)}>{children}</td>;
}

/** A destructive button that asks for a second click inline instead of opening a dialog. */
export function ConfirmButton({
  children,
  confirmLabel = 'Click again to confirm',
  onConfirm,
  variant = 'danger',
  size = 'sm',
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  confirmLabel?: ReactNode;
  onConfirm: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'good';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      size={size}
      variant={armed ? 'danger' : variant}
      disabled={disabled}
      title={title}
      className={cx(armed && 'ring-1 ring-bad/60', className)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
