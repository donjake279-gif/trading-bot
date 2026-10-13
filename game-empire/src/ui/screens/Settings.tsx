import { useRef, useState } from 'react';
import { ClipboardPaste, Copy, Crown, Download, LogOut, Save, Upload } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { exportFile, listSlots, serializeWorld } from '../../engine/save';
import { date, money } from '../lib/format';
import { IS_ARTIFACT } from '../lib/env';
import { Button, Card, ConfirmButton, Kv, Modal, SectionTitle, Tabs, inputClass } from '../components/ui';
import { retire } from '../../engine/legacy';

/** Paste a save code (the JSON a "Copy save code" produced) to load it. */
export function PasteSaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const importSave = useGameStore((s) => s.importSave);
  const [text, setText] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Load a save code"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              importSave(text.trim());
              setText('');
              onClose();
            }}
          >
            Load save
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-sub">Paste the save code you copied from Game &amp; Saves.</p>
      <textarea id="paste-save" className={`${inputClass} h-40 py-2 font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"version":1,...}' />
    </Modal>
  );
}

export function Settings() {
  const w = useWorld();
  const saveNow = useGameStore((s) => s.saveNow);
  const slotId = useGameStore((s) => s.slotId);
  const lastSavedAt = useGameStore((s) => s.lastSavedAt);
  const autosave = useGameStore((s) => s.autosave);
  const setAutosave = useGameStore((s) => s.setAutosave);
  const toastLevel = useGameStore((s) => s.toastLevel);
  const setToastLevel = useGameStore((s) => s.setToastLevel);
  const quit = useGameStore((s) => s.quitToMenu);
  const act = useGameStore((s) => s.act);
  const importSave = useGameStore((s) => s.importSave);
  const pushToast = useGameStore((s) => s.pushToast);
  const [name, setName] = useState('');
  const [slots, setSlots] = useState(() => listSlots());
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [fallbackCode, setFallbackCode] = useState<string | null>(null);
  const copySave = async () => {
    const code = serializeWorld(w);
    try {
      await navigator.clipboard.writeText(code);
      pushToast('Save code copied. Keep it somewhere safe.', 'good');
      setFallbackCode(null);
    } catch {
      setFallbackCode(code);
    }
  };

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
            {IS_ARTIFACT ? (
              <Button onClick={copySave}>
                <Copy size={14} /> Copy save code
              </Button>
            ) : (
              <Button onClick={() => exportFile(w)}>
                <Download size={14} /> Export save file
              </Button>
            )}
            <Button onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Import save file
            </Button>
            <Button onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={14} /> Paste save code
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
          {IS_ARTIFACT && <p className="mt-2 text-xs text-muted">Saves live in this browser. Copy the save code to move a game to another device or browser.</p>}
          {fallbackCode && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-warn">Copying was blocked. Select all of the code below and copy it yourself.</p>
              <textarea id="save-code" readOnly className={`${inputClass} h-28 py-2 font-mono text-[10px]`} value={fallbackCode} onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
          <PasteSaveModal open={pasteOpen} onClose={() => setPasteOpen(false)} />
        </Card>
        <Card title="Options">
          <label className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              Autosave every 30 in-game days
              <div className="text-xs text-muted">Also saves when you close the tab.</div>
            </span>
            <input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
            <span>
              Notification pop-ups
              <div className="text-xs text-muted">Everything is still kept in the notification history (bell icon).</div>
            </span>
            <Tabs
              value={toastLevel}
              onChange={setToastLevel}
              tabs={[
                { id: 'all', label: 'All' },
                { id: 'important', label: 'Important' },
                { id: 'off', label: 'Off' },
              ]}
            />
          </div>
          <div className="mt-3 border-t border-line-soft pt-3">
            <Kv k="World seed" v={w.seed.toString(16).toUpperCase()} />
            <Kv k="Difficulty" v={w.difficulty} />
            <Kv k="Simulation day" v={`${w.day} (${date(w.day)})`} />
          </div>
          <div className="mt-3 text-xs text-muted">Keyboard: Space pauses/resumes, 1–4 set the speed.</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="danger" onClick={quit}>
              <LogOut size={14} /> Save &amp; quit to menu
            </Button>
            <ConfirmButton size="md" variant="secondary" confirmLabel="End this run and bank legacy?" onConfirm={() => act((world) => retire(world))} disabled={!!w.player.gameOver}>
              <Crown size={14} /> Retire &amp; bank legacy
            </ConfirmButton>
          </div>
          <div className="mt-1.5 text-xs text-muted">Retiring ends this run on your terms and banks legacy points for your next studio.</div>
        </Card>
      </div>
    </div>
  );
}
