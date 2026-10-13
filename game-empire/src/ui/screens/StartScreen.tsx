import { useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Code, Crown, Gamepad2, Palette, PenTool, Play, Trash, Upload } from 'lucide-react';
import { PasteSaveModal } from './Settings';
import { useGameStore } from '../../store/gameStore';
import { deleteSlot, listSlots, type SlotMeta } from '../../engine/save';
import { DIFFICULTIES, LEGACY_BONUSES } from '../../engine/constants';
import { legacyCost, loadLegacy, spendLegacy } from '../../engine/legacy';
import type { Difficulty, LegacyId } from '../../engine/types';
import { date, money } from '../lib/format';
import { Button, Field, cx, inputClass } from '../components/ui';

const SPECIALTIES = [
  { id: 'programmer' as const, label: 'Programmer', icon: <Code size={18} />, blurb: 'Strong technology and gameplay systems.' },
  { id: 'designer' as const, label: 'Designer', icon: <PenTool size={18} />, blurb: 'Strong gameplay, content and story.' },
  { id: 'artist' as const, label: 'Artist', icon: <Palette size={18} />, blurb: 'Strong graphics and world art.' },
];

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function StartScreen() {
  const newGame = useGameStore((s) => s.newGame);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const importSave = useGameStore((s) => s.importSave);
  const error = useGameStore((s) => s.error);
  const clearError = useGameStore((s) => s.clearError);
  const [slots, setSlots] = useState<SlotMeta[]>(() => listSlots());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [companyName, setCompanyName] = useState('Pixel Garage Games');
  const [founderName, setFounderName] = useState('');
  const [specialty, setSpecialty] = useState<'programmer' | 'artist' | 'designer'>('designer');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [seed, setSeed] = useState(randomSeed);
  const [rivals, setRivals] = useState(24);
  const [legacy, setLegacy] = useState<Partial<Record<LegacyId, number>>>({});
  const bank = useMemo(() => loadLegacy(), []);
  const legacySpend = legacyCost(legacy);
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = useMemo(() => slots.find((s) => !s.gameOver), [slots]);

  const start = () => {
    const picks = legacySpend > 0 && spendLegacy(legacy) ? legacy : undefined;
    newGame({ seed, companyName: companyName.trim() || 'Pixel Garage Games', founderName: founderName.trim() || 'You', specialty, difficulty, rivals, legacy: picks });
  };

  return (
    <div className="min-h-full bg-[radial-gradient(ellipse_at_top,_#14243a_0%,_#0b1017_60%)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 lg:flex-row lg:py-16">
        <div className="lg:w-[46%]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent shadow-lg shadow-accent/30">
              <Gamepad2 size={26} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Game Empire</h1>
              <p className="text-sm text-muted">Advanced game development tycoon</p>
            </div>
          </div>
          <p className="mt-6 text-base leading-relaxed text-sub">
            Start with <span className="font-semibold text-ink">$50,000</span>, a bedroom and a dream. Build games for a living, breathing industry of rival
            studios and millions of simulated players. Ship hits, survive flops, raise capital, go public, buy your rivals — or lose everything.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-sub">
            {[
              '15–30 autonomous rival studios that grow, merge, IPO and go bankrupt',
              'Live player counts, reviews, churn, updates and expansions',
              'Loans, venture capital, IPOs, stock trading and hostile takeovers',
              'Build your own engine, discover secret genre combos, host conventions, open your own store',
              'Seeded, deterministic simulation with pause, speed-up and saves',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {t}
              </li>
            ))}
          </ul>

          {latest && (
            <button
              onClick={() => loadSlot(latest.id)}
              className="mt-8 flex w-full items-center gap-4 rounded-xl border border-accent/40 bg-accent-soft/40 px-5 py-4 text-left transition-colors hover:bg-accent-soft/70"
            >
              <Play size={22} className="text-accent" />
              <div className="flex-1">
                <div className="font-semibold">Continue: {latest.companyName}</div>
                <div className="text-xs text-sub">
                  {date(latest.day)} · valued at {money(latest.valuation)} · saved {new Date(latest.savedAt).toLocaleString()}
                </div>
              </div>
            </button>
          )}

          {slots.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Saved games</div>
              <div className="space-y-1.5">
                {slots.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {s.name} {s.gameOver && <span className="ml-1 text-xs text-bad">(ended)</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {date(s.day)} · {money(s.valuation)} · {new Date(s.savedAt).toLocaleDateString()}
                      </div>
                    </div>
                    {confirmDelete === s.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={async () => {
                            await deleteSlot(s.id);
                            setConfirmDelete(null);
                            setSlots(listSlots());
                          }}
                        >
                          Delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => loadSlot(s.id)}>
                          Load
                        </Button>
                        <button
                          onClick={() => setConfirmDelete(s.id)}
                          className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad"
                          aria-label={`Delete save ${s.name}`}
                        >
                          <Trash size={15} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) importSave(await f.text());
              e.target.value = '';
            }}
          />
          <div className="mt-3 flex flex-wrap gap-1">
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Import save file
            </Button>
            <Button variant="ghost" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={15} /> Paste save code
            </Button>
          </div>
          <PasteSaveModal open={pasteOpen} onClose={() => setPasteOpen(false)} />
          {error && (
            <div className="mt-3 rounded-lg border border-bad/40 bg-bad-soft px-3 py-2 text-sm text-bad" onClick={clearError}>
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 rounded-2xl border border-line bg-surface p-6 shadow-2xl">
          <h2 className="text-lg font-semibold">Found a new studio</h2>
          <p className="mt-1 text-sm text-muted">Every seed generates a different industry.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Company name">
              <input className={inputClass} value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={40} />
            </Field>
            <Field label="Founder name (you)">
              <input className={inputClass} value={founderName} onChange={(e) => setFounderName(e.target.value)} placeholder="Your name" maxLength={30} />
            </Field>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium text-sub">Your background</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {SPECIALTIES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSpecialty(s.id)}
                  className={cx('rounded-lg border px-3 py-2.5 text-left transition-colors', specialty === s.id ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface-2 hover:border-sub')}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="text-accent">{s.icon}</span>
                    {s.label}
                  </div>
                  <div className="mt-1 text-xs text-muted">{s.blurb}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium text-sub">Difficulty</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={cx('rounded-lg border px-3 py-2.5 text-left transition-colors', difficulty === d ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface-2 hover:border-sub')}
                >
                  <div className="flex items-center justify-between text-sm font-semibold">
                    {DIFFICULTIES[d].name}
                    <span className="text-xs font-normal text-sub">{money(DIFFICULTIES[d].cash)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{DIFFICULTIES[d].blurb}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="World seed" hint="same seed = same world">
              <div className="flex gap-2">
                <input className={inputClass} value={seed} onChange={(e) => setSeed(e.target.value.toUpperCase())} maxLength={16} />
                <Button onClick={() => setSeed(randomSeed())} title="Random seed">
                  ⟳
                </Button>
              </div>
            </Field>
            <Field label="Rival studios" hint={`${rivals}`}>
              <input type="range" min={15} max={30} value={rivals} onChange={(e) => setRivals(Number(e.target.value))} className="mt-2 w-full" />
            </Field>
          </div>
          {bank.points > 0 && (
            <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft/20 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Crown size={15} className="text-warn" /> Legacy head starts
                </span>
                <span className="tabular text-sub">
                  {bank.points - legacySpend} / {bank.points} points left
                </span>
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {(Object.keys(LEGACY_BONUSES) as LegacyId[]).map((id) => {
                  const def = LEGACY_BONUSES[id];
                  const n = legacy[id] ?? 0;
                  const canAdd = n < def.max && legacySpend + def.cost <= bank.points;
                  return (
                    <div key={id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold">
                          {def.name} {n > 0 && <span className="text-warn">×{n}</span>}
                        </div>
                        <div className="text-[10px] text-muted">
                          {def.blurb} {def.cost} pts
                        </div>
                      </div>
                      <button disabled={n <= 0} onClick={() => setLegacy({ ...legacy, [id]: n - 1 })} className="h-6 w-6 rounded border border-line text-sm disabled:opacity-30" aria-label={`Less ${def.name}`}>
                        −
                      </button>
                      <button disabled={!canAdd} onClick={() => setLegacy({ ...legacy, [id]: n + 1 })} className="h-6 w-6 rounded border border-line text-sm disabled:opacity-30" aria-label={`More ${def.name}`}>
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={start}>
            <Play size={18} /> Start your empire
          </Button>
          <p className="mt-3 text-center text-xs text-muted">The industry simulates 18 months of history before you arrive. This takes a moment.</p>
        </div>
      </div>
    </div>
  );
}

export function GeneratingScreen() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4">
      <div className="relative h-1.5 w-72 overflow-hidden rounded-full bg-surface-2">
        <div className="shimmer absolute inset-0" />
      </div>
      <div className="text-sm text-sub">Generating the industry and simulating 18 months of history…</div>
      <div className="text-xs text-muted">Rival studios are founding companies, shipping games and fighting for players.</div>
    </div>
  );
}
