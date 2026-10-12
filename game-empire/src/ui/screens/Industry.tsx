import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Gavel, Minus, Trophy } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { GENRES, GENRE_IDS, MONETIZATIONS, PLATFORMS, PLATFORM_IDS, SCOPES } from '../../engine/constants';
import { genreTrend, totalActivePlayers } from '../../engine/market';
import { auctionEstimate, bidAuction } from '../../engine/actions';
import { MAX_PUBLISHING_DEALS, fundPublishing, publishingOpportunities, publishingTerms } from '../../engine/business';
import { groupRoot, playerCompany } from '../../engine/util';
import { date, money, num, pct, SERIES } from '../lib/format';
import { Donut, Sparkline, TimeChart, foldSlices } from '../components/charts';
import { Badge, Button, Card, CompanyDot, LiveNumber, ScoreBadge, SectionTitle, Stat, Td, Th, cx, inputClass } from '../components/ui';

export function Industry() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const live = Object.values(w.games).filter((g) => g.status === 'released');
  const top = [...live].sort((a, b) => b.ccu - a.ccu).slice(0, 25);
  const totalCcu = live.reduce((s, g) => s + g.ccu, 0);
  const dailyRev = live.reduce((s, g) => s + g.dailyRevenue, 0);
  const studios = Object.values(w.companies).filter((c) => c.status === 'active');
  const me = playerCompany(w);

  // market share by group (30-day revenue)
  const shareMap = new Map<string, number>();
  for (const g of live) {
    const root = groupRoot(w, w.companies[g.companyId]);
    shareMap.set(root.id, (shareMap.get(root.id) ?? 0) + g.rev30);
  }
  const slices = foldSlices(
    [...shareMap.entries()].map(([id, v]) => ({ name: w.companies[id].isPlayer ? `${w.companies[id].name} (you)` : w.companies[id].name, value: v })),
    SERIES,
  );

  const anticipated = Object.values(w.games)
    .filter((g) => g.status === 'development' && g.companyId !== me.id && g.hype > 20)
    .sort((a, b) => b.hype - a.hype)
    .slice(0, 8);

  const genres = [...GENRE_IDS].sort((a, b) => genreTrend(w, b) - genreTrend(w, a));
  const effects = w.market.effects;

  return (
    <div className="space-y-4">
      <SectionTitle>Industry</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Players online now" icon={<span className="live-dot" style={{ width: 6, height: 6 }} />} value={<LiveNumber value={totalCcu} format={(n) => num(n, 2)} />} />
        <Stat label="Active players" value={num(totalActivePlayers(w))} />
        <Stat label="Industry revenue" value={`${money(dailyRev)}/day`} sub={`~${money(dailyRev * 365)}/yr`} />
        <Stat label="Live games" value={live.length} />
        <Stat label="Active studios" value={studios.filter((c) => !c.parentId).length} sub={`${studios.filter((c) => c.parentId).length} subsidiaries`} />
        <Stat label="Consumer spending" value={pct(w.market.sentiment)} tone={w.market.sentiment < 0.9 ? 'bad' : w.market.sentiment > 1.05 ? 'good' : undefined} sub={`Markets: ${w.market.regime}`} />
      </div>
      {effects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {effects.map((e) => (
            <Badge key={e.id} tone={e.mult >= 1 ? 'good' : 'bad'}>
              {e.label} · until {date(e.until)}
            </Badge>
          ))}
        </div>
      )}

      <Card title="Live charts: most played right now" subtitle="Concurrent players across the whole industry" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line-soft">
              <tr>
                <Th>#</Th>
                <Th>Game</Th>
                <Th>Studio</Th>
                <Th className="text-right">Online</Th>
                <Th className="text-right">7-day</Th>
                <Th>60 days</Th>
                <Th className="text-right">Active</Th>
                <Th className="text-center">Score</Th>
                <Th className="text-right">Rev 30d</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {top.map((g, i) => {
                const c = w.companies[g.companyId];
                const weekAgo = g.history.find((h) => h[0] >= w.day - 7)?.[2] ?? g.ccu;
                const change = weekAgo > 0 ? g.ccu / weekAgo - 1 : 0;
                const mine = c.id === me.id || c.parentId === me.id;
                return (
                  <tr
                    key={g.id}
                    onClick={() => (c.id === me.id ? navigate({ name: 'game', id: g.id }) : navigate({ name: 'company', id: c.id }))}
                    className={cx('cursor-pointer hover:bg-surface-2', mine && 'bg-accent-soft/30')}
                  >
                    <Td className="text-muted">{i + 1}</Td>
                    <Td>
                      <div className="font-medium">{g.title}</div>
                      <div className="text-[11px] text-muted">
                        {GENRES[g.genre].name} · {MONETIZATIONS[g.monetization].short} · {SCOPES[g.scope].name.split(' ')[0]}
                      </div>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2 text-sub">
                        <CompanyDot color={c.color} />
                        {c.name}
                      </span>
                    </Td>
                    <Td className="text-right font-semibold">
                      <LiveNumber value={g.ccu} format={(n) => Math.round(n).toLocaleString()} />
                    </Td>
                    <Td className={cx('text-right tabular text-xs', change > 0.02 ? 'text-good' : change < -0.02 ? 'text-bad' : 'text-muted')}>
                      {change >= 0 ? '+' : ''}
                      {(change * 100).toFixed(0)}%
                    </Td>
                    <Td>
                      <Sparkline data={g.history.slice(-60).map((h) => h[2])} color={mine ? '#3987e5' : '#6b7a8a'} />
                    </Td>
                    <Td className="text-right tabular text-sub">{num(g.active)}</Td>
                    <Td className="text-center">
                      <ScoreBadge score={g.criticScore} />
                    </Td>
                    <Td className="text-right tabular">{money(g.rev30)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Market share" subtitle="By 30-day revenue, studio groups">
          <Donut slices={slices} format={(n) => money(n)} />
        </Card>
        <Card title="Genre popularity" subtitle="Player interest vs. normal (100)">
          <div className="space-y-1.5">
            {genres.map((gid) => {
              const t = genreTrend(w, gid);
              const hist = w.market.genres[gid].history.slice(-24).map((p) => p[1]);
              return (
                <div key={gid} className="flex items-center gap-3 text-sm">
                  <span className="w-24 truncate">{GENRES[gid].name}</span>
                  <Sparkline data={[...hist, w.market.genres[gid].trend]} color={t > 1.08 ? '#199e70' : t < 0.92 ? '#e66767' : '#6b7a8a'} width={80} height={20} />
                  <span className={cx('ml-auto flex items-center gap-0.5 text-xs tabular', t > 1.08 ? 'text-good' : t < 0.92 ? 'text-bad' : 'text-sub')}>
                    {t > 1.08 ? <ArrowUpRight size={12} /> : t < 0.92 ? <ArrowDownRight size={12} /> : <Minus size={12} />}
                    {Math.round(t * 100)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Platforms" subtitle="Installed base and growth">
          <div className="space-y-2">
            {PLATFORM_IDS.map((p) => (
              <div key={p} className="flex items-center justify-between text-sm">
                <span>{PLATFORMS[p].name}</span>
                <span className="flex items-center gap-3">
                  <Sparkline data={w.market.platforms[p].history.slice(-24).map((x) => x[1])} width={70} height={18} color="#6b7a8a" />
                  <span className="w-16 text-right tabular">{num(w.market.platforms[p].users * 1e6)}</span>
                  <span className="w-12 text-right text-xs tabular text-good">+{pct(w.market.platforms[p].growth)}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line-soft pt-3">
            <div className="mb-1 text-xs font-medium text-sub">Industry active players</div>
            <TimeChart series={[{ key: 'a', name: 'Active players', color: '#3987e5', data: w.market.industryHistory.map((h) => [h[0], h[1]] as [number, number]) }]} format={(n) => num(n)} height={120} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Most anticipated" subtitle="Rival games in development, by hype" pad={false}>
          <div className="divide-y divide-line-soft">
            {anticipated.map((g) => {
              const c = w.companies[g.companyId];
              return (
                <button key={g.id} onClick={() => navigate({ name: 'company', id: c.id })} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2">
                  <CompanyDot color={c.color} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{g.title}</div>
                    <div className="text-[11px] text-muted">
                      {c.name} · {SCOPES[g.scope].name} {GENRES[g.genre].name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-sub">{Math.round(g.hype)} hype</div>
                    <div className="text-[11px] text-muted">{g.workDone / g.workRequired > 0.85 ? 'Coming soon' : 'In production'}</div>
                  </div>
                </button>
              );
            })}
            {anticipated.length === 0 && <div className="p-4 text-sm text-muted">Nothing hyped right now.</div>}
          </div>
        </Card>
        <div className="space-y-4">
          <Publishing />
          <Auctions />
          <Card title="Game Awards" subtitle="Recent winners" pad={false}>
            <div className="divide-y divide-line-soft">
              {[...w.awardsHistory].reverse().slice(0, 8).map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Trophy size={14} className="text-warn" />
                  <span className="w-12 text-xs text-muted">{a.year}</span>
                  <span className="w-32 shrink-0 text-xs text-sub">{a.category}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                  <span className="truncate text-xs text-muted">{w.companies[a.companyId]?.name}</span>
                </div>
              ))}
              {w.awardsHistory.length === 0 && <div className="p-4 text-sm text-muted">The first ceremony happens every December.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Auctions() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const open = w.auctions.filter((a) => !a.resolved);
  const [bids, setBids] = useState<Record<string, number>>({});
  return (
    <Card title="IP auctions" subtitle="Bankrupt studios' franchises go to the highest sealed bid">
      {open.length === 0 ? (
        <div className="text-sm text-muted">No auctions right now. They appear when studios go bankrupt.</div>
      ) : (
        <div className="space-y-2">
          {open.map((a) => {
            const est = auctionEstimate(w, a.id);
            const myBid = a.bids[w.player.companyId];
            return (
              <div key={a.id} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Gavel size={14} className="text-warn" />
                      {a.ipName}
                    </div>
                    <div className="text-[11px] text-muted">
                      from {a.fromCompany} · {num(w.ips[a.ipId]?.fans ?? 0)} fans · closes {date(a.endsDay)}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-sub">est. value {money(est)}</div>
                    <div className="text-muted">min {money(a.minBid)}</div>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <input type="number" className={inputClass} placeholder={String(a.minBid)} value={bids[a.id] ?? ''} onChange={(e) => setBids({ ...bids, [a.id]: Number(e.target.value) })} />
                  <Button onClick={() => act((world) => bidAuction(world, a.id, bids[a.id] ?? a.minBid), 'Sealed bid placed')}>Bid</Button>
                </div>
                {myBid && <div className="mt-1 text-xs text-accent">Your sealed bid: {money(myBid)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Publishing() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const me = playerCompany(w);
  const opps = publishingOpportunities(w).slice(0, 6);
  const full = w.player.publishing.length >= MAX_PUBLISHING_DEALS;
  return (
    <Card
      title="Publish an indie game"
      subtitle={`Fund a smaller studio's game for a share of its revenue for life. ${w.player.publishing.length}/${MAX_PUBLISHING_DEALS} deals.`}
      pad={false}
    >
      <div className="divide-y divide-line-soft">
        {opps.map((g) => {
          const c = w.companies[g.companyId];
          const t = publishingTerms(w, g);
          return (
            <div key={g.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <CompanyDot color={c.color} />
              <button className="min-w-0 flex-1 text-left" onClick={() => navigate({ name: 'company', id: c.id })}>
                <div className="truncate font-medium">{g.title}</div>
                <div className="text-[11px] text-muted">
                  {c.name} · {SCOPES[g.scope].name} {GENRES[g.genre].name} · {Math.round((g.workDone / g.workRequired) * 100)}% done · talent {Math.round(c.talent)}
                </div>
              </button>
              <div className="text-right text-xs">
                <div className="tabular text-sub">{pct(t.share)} share</div>
                <div className="text-[11px] text-muted">{Math.round(g.hype)} hype</div>
              </div>
              <Button size="sm" disabled={full || me.cash < t.price} onClick={() => act((world) => fundPublishing(world, g.id), `You will publish ${g.title}`)}>
                {money(t.price)}
              </Button>
            </div>
          );
        })}
        {opps.length === 0 && <div className="p-4 text-sm text-muted">No independent studios are looking for a publisher right now.</div>}
      </div>
    </Card>
  );
}
