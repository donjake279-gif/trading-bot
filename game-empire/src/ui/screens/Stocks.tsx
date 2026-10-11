import { useState } from 'react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { revenueTTM } from '../../engine/finance';
import { buyback, ipoBlocker, secondaryOffering } from '../../engine/actions';
import { founderStake, marketCap } from '../../engine/stocks';
import { playerCompany } from '../../engine/util';
import type { Company } from '../../engine/types';
import { money, num, pct, signedPct } from '../lib/format';
import { Sparkline, TimeChart } from '../components/charts';
import { Badge, Button, Card, CompanyDot, Empty, Kv, SectionTitle, Stat, Td, Th, cx, inputClass } from '../components/ui';

function change(c: Company, daysBack: number): number {
  const h = c.priceHistory;
  if (h.length < 2) return 0;
  const last = h[h.length - 1];
  const ref = [...h].reverse().find((p) => p[0] <= last[0] - daysBack) ?? h[0];
  return ref[1] > 0 ? last[1] / ref[1] - 1 : 0;
}

export function Stocks() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const me = playerCompany(w);
  const listed = Object.values(w.companies)
    .filter((c) => c.isPublic && c.status === 'active')
    .sort((a, b) => marketCap(b) - marketCap(a));
  const holdings = Object.entries(me.holdings)
    .map(([id, h]) => ({ c: w.companies[id], h }))
    .filter((x) => x.c);
  const portValue = holdings.reduce((s, x) => s + x.h.shares * x.c.price, 0);
  const portCost = holdings.reduce((s, x) => s + x.h.cost, 0);
  const idx = w.market.indexHistory;
  const idxChange = idx.length > 30 ? w.market.index / idx[Math.max(0, idx.length - 31)][1] - 1 : 0;

  return (
    <div className="space-y-4">
      <SectionTitle>Stock market</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Game Empire Index" value={w.market.index.toFixed(0)} sub={`${signedPct(idxChange)} last 30 days`} tone={idxChange >= 0 ? 'good' : 'bad'} />
        <Stat label="Market mood" value={w.market.regime === 'bull' ? 'Bull market' : w.market.regime === 'bear' ? 'Bear market' : 'Neutral'} tone={w.market.regime === 'bull' ? 'good' : w.market.regime === 'bear' ? 'bad' : undefined} />
        <Stat label="Your portfolio" value={money(portValue)} sub={portCost > 0 ? `${signedPct(portValue / portCost - 1)} return` : 'No holdings'} />
        <Stat label="Base interest rate" value={pct(w.market.baseRate, 2)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Game Empire Index" subtitle="Sector-wide index of listed game companies">
          <TimeChart series={[{ key: 'i', name: 'Index', color: '#3987e5', data: idx.filter((p) => p[0] >= w.day - 730) }]} format={(n) => n.toFixed(0)} area={false} yDomain={['auto', 'auto']} height={240} />
        </Card>
        <OwnStock />
      </div>

      <Card title="Your holdings" pad={false}>
        {holdings.length === 0 ? (
          <div className="p-4">
            <Empty title="You don't own any shares">Buy shares of listed rivals below. Owning a big stake lowers the price of acquiring them later.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line-soft">
                <tr>
                  <Th>Company</Th>
                  <Th className="text-right">Shares</Th>
                  <Th className="text-right">Stake</Th>
                  <Th className="text-right">Avg cost</Th>
                  <Th className="text-right">Price</Th>
                  <Th className="text-right">Value</Th>
                  <Th className="text-right">P/L</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {holdings.map(({ c, h }) => {
                  const value = h.shares * c.price;
                  const pl = value - h.cost;
                  return (
                    <tr key={c.id} onClick={() => navigate({ name: 'company', id: c.id })} className="cursor-pointer hover:bg-surface-2">
                      <Td>
                        <span className="flex items-center gap-2 font-medium">
                          <CompanyDot color={c.color} />
                          {c.name}
                          {c.status !== 'active' && <Badge tone="bad">{c.status}</Badge>}
                        </span>
                      </Td>
                      <Td className="text-right tabular">{num(h.shares)}</Td>
                      <Td className="text-right tabular">{pct(h.shares / c.shares, 2)}</Td>
                      <Td className="text-right tabular">${(h.cost / h.shares).toFixed(2)}</Td>
                      <Td className="text-right tabular">${c.price.toFixed(2)}</Td>
                      <Td className="text-right tabular">{money(value)}</Td>
                      <Td className={cx('text-right tabular', pl >= 0 ? 'text-good' : 'text-bad')}>
                        {money(pl)} ({signedPct(h.cost > 0 ? pl / h.cost : 0)})
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Listed companies" subtitle="Click a company to trade or make an offer" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line-soft">
              <tr>
                <Th>Company</Th>
                <Th className="text-right">Price</Th>
                <Th className="text-right">1 day</Th>
                <Th className="text-right">30 days</Th>
                <Th>90 days</Th>
                <Th className="text-right">Market cap</Th>
                <Th className="text-right">P/S</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {listed.map((c) => {
                const d1 = change(c, 1);
                const d30 = change(c, 30);
                const rev = revenueTTM(c);
                return (
                  <tr key={c.id} onClick={() => (c.isPlayer ? undefined : navigate({ name: 'company', id: c.id }))} className={cx('hover:bg-surface-2', !c.isPlayer && 'cursor-pointer', c.isPlayer && 'bg-accent-soft/30')}>
                    <Td>
                      <span className="flex items-center gap-2 font-medium">
                        <CompanyDot color={c.color} />
                        {c.name} {c.isPlayer && <Badge tone="accent">You</Badge>}
                      </span>
                    </Td>
                    <Td className="text-right font-semibold tabular">${c.price.toFixed(2)}</Td>
                    <Td className={cx('text-right tabular text-xs', d1 >= 0 ? 'text-good' : 'text-bad')}>{signedPct(d1)}</Td>
                    <Td className={cx('text-right tabular text-xs', d30 >= 0 ? 'text-good' : 'text-bad')}>{signedPct(d30)}</Td>
                    <Td>
                      <Sparkline data={c.priceHistory.slice(-90).map((p) => p[1])} color={d30 >= 0 ? '#199e70' : '#e66767'} />
                    </Td>
                    <Td className="text-right tabular">{money(marketCap(c))}</Td>
                    <Td className="text-right tabular text-sub">{rev > 0 ? (marketCap(c) / rev).toFixed(1) : '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function OwnStock() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const c = playerCompany(w);
  const [amount, setAmount] = useState(1_000_000);
  if (!c.isPublic) {
    const blocker = ipoBlocker(w);
    return (
      <Card title="Your company" subtitle="Private">
        <p className="text-sm text-sub">{blocker ? `Not ready for an IPO yet: ${blocker}` : 'You meet the requirements to go public!'}</p>
        <Button className="mt-3" variant={blocker ? 'secondary' : 'primary'} onClick={() => navigate({ name: 'finance' })}>
          Open Finance
        </Button>
      </Card>
    );
  }
  return (
    <Card title={`${c.name} stock`} subtitle={`$${c.price.toFixed(2)} · ${signedPct(change(c, 30))} 30d`}>
      <TimeChart series={[{ key: 'p', name: 'Share price', color: '#3987e5', data: c.priceHistory.filter((p) => p[0] >= w.day - 365) }]} format={(n) => `$${n.toFixed(2)}`} area={false} yDomain={['auto', 'auto']} height={120} />
      <div className="mt-2">
        <Kv k="Market cap" v={money(marketCap(c))} />
        <Kv k="Your stake" v={pct(founderStake(c), 1)} tone={founderStake(c) < 0.5 ? 'warn' : undefined} />
        <Kv k="Board confidence" v={`${Math.round(c.boardConfidence)}%`} tone={c.boardConfidence < 30 ? 'bad' : undefined} />
      </div>
      <input type="number" className={cx(inputClass, 'mt-2')} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => act((world) => buyback(world, amount))} title="Buy back shares: raises your ownership %">
          Buy back {money(amount)}
        </Button>
        <Button size="sm" onClick={() => act((world) => secondaryOffering(world, 0.05))} title="Issue 5% new shares: raises cash, dilutes you">
          Issue 5% new shares
        </Button>
      </div>
    </Card>
  );
}
