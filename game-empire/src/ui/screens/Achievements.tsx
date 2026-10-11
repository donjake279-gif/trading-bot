import { Lock, Trophy } from 'lucide-react';
import { useWorld } from '../../store/gameStore';
import { ACHIEVEMENTS } from '../../engine/achievements';
import { playerCompany } from '../../engine/util';
import { date, money, num } from '../lib/format';
import { Card, Kv, SectionTitle, cx } from '../components/ui';

export function Achievements() {
  const w = useWorld();
  const c = playerCompany(w);
  const s = w.player.stats;
  const unlocked = Object.keys(w.player.achievements).length;
  return (
    <div className="space-y-4">
      <SectionTitle>Achievements</SectionTitle>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ACHIEVEMENTS.map((a) => {
            const day = w.player.achievements[a.id];
            const done = day !== undefined;
            return (
              <div key={a.id} className={cx('flex gap-3 rounded-xl border p-3', done ? 'border-warn/40 bg-warn-soft/40' : 'border-line bg-surface')}>
                <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', done ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted')}>
                  {done ? <Trophy size={17} /> : <Lock size={15} />}
                </div>
                <div>
                  <div className={cx('text-sm font-semibold', !done && 'text-sub')}>{a.name}</div>
                  <div className="text-xs text-muted">{a.desc}</div>
                  {done && <div className="mt-0.5 text-[11px] text-warn">Unlocked {date(day)}</div>}
                </div>
              </div>
            );
          })}
        </div>
        <Card title={`Career · ${unlocked}/${ACHIEVEMENTS.length} achievements`}>
          <Kv k="Founded" v={date(c.founded)} />
          <Kv k="Games released" v={s.gamesReleased} />
          <Kv k="Best critic score" v={s.bestCritic || '—'} />
          <Kv k="Peak concurrent players" v={num(s.peakCcu)} />
          <Kv k="Lifetime revenue" v={money(c.revenueTotal)} />
          <Kv k="Peak valuation" v={money(s.peakValuation)} />
          <Kv k="Acquisitions" v={s.acquisitions} />
          <Kv k="Awards won" v={w.awardsHistory.filter((x) => x.companyId === c.id).length} />
        </Card>
      </div>
    </div>
  );
}
