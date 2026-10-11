import { useState } from 'react';
import { Award, Building, ChartCandlestick, Gamepad2, Landmark, Newspaper, Sparkles, User } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import type { NewsItem, NewsKind } from '../../engine/types';
import { date } from '../lib/format';
import { Empty, SectionTitle, Tabs, cx, inputClass } from '../components/ui';

const ICONS: Record<NewsKind, typeof Newspaper> = {
  player: User,
  release: Gamepad2,
  industry: Building,
  market: ChartCandlestick,
  finance: Landmark,
  event: Sparkles,
  awards: Award,
};

export function NewsList({ items, compact }: { items: NewsItem[]; compact?: boolean }) {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  if (items.length === 0) return <Empty title="No news yet" />;
  return (
    <div className={cx('divide-y divide-line-soft', !compact && 'rounded-xl border border-line bg-surface')}>
      {items.map((n) => {
        const Icon = ICONS[n.kind];
        const game = n.gameId ? w.games[n.gameId] : undefined;
        const clickable = game || n.companyId;
        const go = () => {
          if (game && game.companyId === w.player.companyId) navigate({ name: 'game', id: game.id });
          else if (n.companyId && n.companyId !== w.player.companyId && w.companies[n.companyId]) navigate({ name: 'company', id: n.companyId });
          else if (game) navigate({ name: 'company', id: game.companyId });
        };
        return (
          <div
            key={n.id}
            onClick={clickable ? go : undefined}
            className={cx('flex gap-3 py-2.5', compact ? '' : 'px-4', clickable && 'cursor-pointer hover:bg-surface-2/60')}
          >
            <div
              className={cx(
                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                n.tone === 'good' ? 'bg-good-soft text-good' : n.tone === 'bad' ? 'bg-bad-soft text-bad' : n.tone === 'major' ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-sub',
              )}
            >
              <Icon size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={cx('text-sm', n.tone === 'major' ? 'font-semibold text-ink' : 'text-ink')}>{n.title}</div>
              {n.body && !compact && <div className="mt-0.5 text-xs text-muted">{n.body}</div>}
              <div className="mt-0.5 text-[11px] text-muted">{date(n.day)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Filter = 'all' | NewsKind;

export function News() {
  const w = useWorld();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const items = w.news.filter((n) => (filter === 'all' || n.kind === filter) && (!q || n.title.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <SectionTitle>News</SectionTitle>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'player', label: 'Your studio' },
            { id: 'release', label: 'Releases' },
            { id: 'industry', label: 'Industry' },
            { id: 'market', label: 'Markets' },
            { id: 'finance', label: 'Deals & finance' },
            { id: 'awards', label: 'Awards' },
          ]}
        />
        <input className={cx(inputClass, 'max-w-xs')} placeholder="Search headlines…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[75vh] overflow-y-auto rounded-xl">
        <NewsList items={items.slice(0, 250)} />
      </div>
    </div>
  );
}
