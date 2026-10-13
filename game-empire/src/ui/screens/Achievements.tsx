import { useState } from 'react';
import { BookOpen, Crown, Disc3, Lock, Trophy } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { ACHIEVEMENTS } from '../../engine/achievements';
import { GENRES, GENRE_IDS, TOPICS, TOPIC_IDS } from '../../engine/constants';
import { certificationName } from '../../engine/fun';
import { TOTAL_COMBOS, comboKey, legendaryCombo } from '../../engine/topics';
import { loadLegacy } from '../../engine/legacy';
import { gamesOf, playerCompany } from '../../engine/util';
import type { ComboGrade } from '../../engine/types';
import { date, money, num } from '../lib/format';
import { Badge, Card, Empty, Kv, ScoreBadge, SectionTitle, Tabs, cx } from '../components/ui';

type Tab = 'achievements' | 'hall' | 'combos';

const GRADE_CELL: Record<ComboGrade, string> = {
  legendary: 'bg-warn text-bg',
  great: 'bg-good/80 text-bg',
  good: 'bg-accent/70 text-white',
  okay: 'bg-surface-3 text-sub',
  bad: 'bg-bad/60 text-white',
};

export function Achievements() {
  const w = useWorld();
  const [tab, setTab] = useState<Tab>('achievements');
  const unlocked = Object.keys(w.player.achievements).length;
  const combos = Object.keys(w.player.combos).length;
  return (
    <div className="space-y-4">
      <SectionTitle
        actions={
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'achievements', label: `Achievements (${unlocked}/${ACHIEVEMENTS.length})` },
              { id: 'hall', label: 'Hall of Fame' },
              { id: 'combos', label: `Combo book (${combos}/${TOTAL_COMBOS})` },
            ]}
          />
        }
      >
        Trophy Room
      </SectionTitle>
      {tab === 'achievements' && <AchievementList />}
      {tab === 'hall' && <HallOfFame />}
      {tab === 'combos' && <ComboBook />}
    </div>
  );
}

function AchievementList() {
  const w = useWorld();
  const c = playerCompany(w);
  const s = w.player.stats;
  const unlocked = Object.keys(w.player.achievements).length;
  const legacy = loadLegacy();
  return (
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
      <div className="space-y-4">
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
        <Card title="Legacy" subtitle="Points banked across runs in this browser. Spend them on head starts when you found a new studio.">
          <Kv k="Legacy points" v={legacy.points} />
          <Kv k="Earned in total" v={legacy.earned} />
          <Kv k="Runs finished" v={legacy.runs} />
          {Object.keys(w.player.legacy).length > 0 && <div className="mt-2 text-xs text-muted">This run started with {Object.keys(w.player.legacy).length} legacy bonus{Object.keys(w.player.legacy).length > 1 ? 'es' : ''}.</div>}
        </Card>
      </div>
    </div>
  );
}

function HallOfFame() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const p = playerCompany(w);
  const famous = gamesOf(w, p.id)
    .filter((g) => g.releaseDay !== null && (g.certified >= 2 || g.criticScore >= 85 || g.awards.length > 0 || (g.topic && legendaryCombo(g.genre, g.topic))))
    .sort((a, b) => b.certified - a.certified || b.criticScore - a.criticScore);
  if (famous.length === 0) {
    return (
      <Empty icon={<Crown size={28} />} title="The wall is still empty">
        Games that go Gold (500K sold), score 85+, win an award or ride a legendary combo get a plaque here.
      </Empty>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {famous.map((g) => {
        const cert = certificationName(g.certified);
        return (
          <button key={g.id} onClick={() => navigate({ name: 'game', id: g.id })} className="card-hover rounded-xl border border-warn/30 bg-gradient-to-br from-warn-soft/40 to-surface p-4 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{g.title}</div>
                <div className="text-xs text-muted">
                  {g.topic ? `${TOPICS[g.topic].emoji} ` : ''}
                  {GENRES[g.genre].name} · {date(g.releaseDay ?? 0)}
                </div>
              </div>
              <ScoreBadge score={g.criticScore} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {cert && (
                <Badge tone="warn">
                  <Disc3 size={11} /> {cert}
                </Badge>
              )}
              {g.awards.map((a) => (
                <Badge key={a} tone="good">
                  <Trophy size={11} /> {a}
                </Badge>
              ))}
              {g.topic && legendaryCombo(g.genre, g.topic) && <Badge tone="accent">Legendary combo</Badge>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted">Players</div>
                <div className="font-semibold tabular">{num(g.owners)}</div>
              </div>
              <div>
                <div className="text-muted">Lifetime revenue</div>
                <div className="font-semibold tabular">{money(g.revenueTotal)}</div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ComboBook() {
  const w = useWorld();
  const found = Object.values(w.player.combos);
  const legendary = found.filter((g) => g === 'legendary').length;
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <BookOpen size={15} className="text-accent" /> Combo book
        </span>
      }
      subtitle={`Every genre and topic pairing you have shipped or seen a rival hit with. ${legendary} legendary combo${legendary === 1 ? '' : 's'} found. There are a few more out there.`}
      pad={false}
    >
      <div className="overflow-x-auto p-3">
        <table className="border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th />
              {TOPIC_IDS.map((t) => (
                <th key={t} className="px-0.5 pb-1 text-center font-normal text-muted" title={TOPICS[t].name}>
                  <span className="text-base">{TOPICS[t].emoji}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GENRE_IDS.map((g) => (
              <tr key={g}>
                <td className="whitespace-nowrap pr-2 text-right text-sub">{GENRES[g].name}</td>
                {TOPIC_IDS.map((t) => {
                  const grade = w.player.combos[comboKey(g, t)];
                  return (
                    <td
                      key={t}
                      title={`${GENRES[g].name} × ${TOPICS[t].name}: ${grade ?? 'not discovered'}`}
                      className={cx('h-6 w-7 rounded text-center align-middle font-bold', grade ? GRADE_CELL[grade] : 'bg-surface-2 text-line')}
                    >
                      {grade === 'legendary' ? '★' : grade ? grade[0].toUpperCase() : '?'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-sub">
          {(['legendary', 'great', 'good', 'okay', 'bad'] as ComboGrade[]).map((g) => (
            <span key={g} className="flex items-center gap-1">
              <span className={cx('inline-block h-3 w-3 rounded', GRADE_CELL[g])} /> {g}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
