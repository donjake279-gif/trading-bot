import { useRef, useState } from 'react';
import { Download, LogOut, Save, Upload } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { exportFile, listSlots } from '../../engine/save';
import { date, money } from '../lib/format';
import { Button, Card, Kv, SectionTitle, inputClass } from '../components/ui';

export function Settings() {
  const w = useWorld();
  const saveNow = useGameStore((s) => s.saveNow);
  const slotId = useGameStore((s) => s.slotId);
  const lastSavedAt = useGameStore((s) => s.lastSavedAt);
  const autosave = useGameStore((s) => s.autosave);
  const setAutosave = useGameStore((s) => s.setAutosave);
  const pauseOnEvents = useGameStore((s) => s.pauseOnEvents);
  const setPauseOnEvents = useGameStore((s) => s.setPauseOnEvents);
  const quit = useGameStore((s) => s.quitToMenu);
  const importSave = useGameStore((s) => s.importSave);
  const pushToast = useGameStore((s) => s.pushToast);
  const [name, setName] = useState('');
  const [slots, setSlots] = useState(() => listSlots());
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <SectionTitle>Game &amp; saves</SectionTitle>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Save game" subtitle={lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Not saved yet this session'}>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                await saveNow(slotId);
                setSlots(listSlots());
                pushToast('Game saved', 'good');
              }}
            >
              <Save size={14} /> Save
            </Button>
            <input className={inputClass} placeholder="Name for a new save slot…" value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              disabled={!name.trim()}
              onClick={async () => {
                await saveNow(`slot-${Date.now().toString(36)}`, name.trim());
                setName('');
                setSlots(listSlots());
                pushToast('Saved to new slot', 'good');
              }}
            >
              Save as
            </Button>
          </div>
          <div className="mt-4 space-y-1">
            {slots.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-1.5 text-sm">
                <span>
                  {s.name} {s.id === slotId && <span className="text-xs text-accent">(current)</span>}
                </span>
                <span className="text-xs text-muted">
                  {date(s.day)} · {money(s.valuation)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => exportFile(w)}>
              <Download size={14} /> Export save file
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Import save file
            </Button>
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
          </div>
        </Card>
        <Card title="Options">
          <label className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              Autosave every 30 in-game days
              <div className="text-xs text-muted">Also saves when you close the tab.</div>
            </span>
            <input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              Pause when a decision is needed
              <div className="text-xs text-muted">Unanswered decisions resolve to a default when they expire.</div>
            </span>
            <input type="checkbox" checked={pauseOnEvents} onChange={(e) => setPauseOnEvents(e.target.checked)} />
          </label>
          <div className="mt-3 border-t border-line-soft pt-3">
            <Kv k="World seed" v={w.seed.toString(16).toUpperCase()} />
            <Kv k="Difficulty" v={w.difficulty} />
            <Kv k="Simulation day" v={`${w.day} (${date(w.day)})`} />
          </div>
          <div className="mt-3 text-xs text-muted">Keyboard: Space pauses/resumes, 1–4 set the speed.</div>
          <Button variant="danger" className="mt-4" onClick={quit}>
            <LogOut size={14} /> Save &amp; quit to menu
          </Button>
        </Card>
      </div>
    </div>
  );
}
