import { useState } from 'react';
import { Briefcase, Handshake, ShoppingCart } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { GENRES, MONETIZATIONS, SCOPES, STRATEGIES, STRATEGY_IDS } from '../../engine/constants';
import { debtOf, revenueTTM } from '../../engine/finance';
import { acquire, acquisitionQuote, buyStock, sellStock, setSubsidiaryStrategy, transferToSubsidiary } from '../../engine/actions';
import { floatShares, founderStake, marketCap, tradeCost } from '../../engine/stocks';
import { playerCompany } from '../../engine/util';
import type { Company, StrategyId } from '../../engine/types';
import { date, int, money, num, pct } from '../lib/format';
import { companyCcu, devGamesOf, liveGamesOf } from '../lib/selectors';
import { StackedBars, TimeChart } from '../components/charts';
import { Badge, Button, Card, CompanyDot, Empty, Kv, LiveNumber, Modal, ScoreBadge, SectionTitle, Stat, Tabs, Td, Th, cx, inputClass } from '../components/ui';

type SortKey = 'valuation' | 'revenue' | 'headcount' | 'reputation' | 'ccu';

function statusBadge(w: ReturnType<typeof useWorld>, c: Company) {
  if (c.status === 'bankrupt') return <Badge tone="bad">Bankrupt</Badge>;
  if (c.parentId) return <Badge tone={c.parentId === w.player.companyId ? 'good' : 'neutral'}>Owned by {w.companies[c.parentId]?.name}</Badge>;
  if (c.isPublic) return <Badge tone="accent">Public · ${c.price.toFixed(2)}</Badge>;
  return <Badge>Private</Badge>;
}

export function Competitors() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const [filter, setFilter] = useState<'active' | 'gone'>('active');
  const [sort, setSort] = useState<SortKey>('valuation');
  const me = playerCompany(w);
  const key = (c: Company) =>
    sort === 'valuation' ? marketCap(c) : sort === 'revenue' ? revenueTTM(c) : sort === 'headcount' ? c.headcount : sort === 'reputation' ? c.reputation : companyCcu(w, c.id);
  const rows = Object.values(w.companies)
    .filter((c) => !c.isPlayer && (filter === 'active' ? c.status === 'active' : c.status !== 'active'))
    .sort((a, b) => key(b) - key(a));

  return (
    <div>
      <SectionTitle>Competitors</SectionTitle>
      <div className="mb-4">
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'active', label: `Active (${Object.values(w.companies).filter((c) => !c.isPlayer && c.status === 'active').length})` },
            { id: 'gone', label: `Defunct (${Object.values(w.companies).filter((c) => c.status !== 'active').length})` },
          ]}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full">
          <thead className="border-b border-line-soft">
            <tr>
              <Th>Studio</Th>
              <Th>Status</Th>
              <Th>Known for</Th>
              <Th className="text-right" onClick={() => setSort('valuation')} active={sort === 'valuation'}>
                Value
              </Th>
              <Th className="text-right" onClick={() => setSort('revenue')} active={sort === 'revenue'}>
                Revenue (TTM)
              </Th>
              <Th className="text-right" onClick={() => setSort('headcount')} active={sort === 'headcount'}>
                Staff
              </Th>
              <Th className="text-right" onClick={() => setSort('reputation')} active={sort === 'reputation'}>
                Rep
              </Th>
              <Th className="text-right" onClick={() => setSort('ccu')} active={sort === 'ccu'}>
                Online
              </Th>
              <Th className="text-right">Games</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((c) => (
              <tr key={c.id} onClick={() => navigate({ name: 'company', id: c.id })} className={cx('cursor-pointer hover:bg-surface-2', c.parentId === me.id && 'bg-good-soft/20')}>
                <Td>
                  <div className="flex items-center gap-2 font-medium">
                    <CompanyDot color={c.color} />
                    {c.name}
                  </div>
                  <div className="pl-[18px] text-[11px] text-muted">{c.hq}</div>
                </Td>
                <Td>{statusBadge(w, c)}</Td>
                <Td className="text-xs text-sub">{c.specialties.map((s) => GENRES[s].name).join(', ')}</Td>
                <Td className="text-right tabular">{money(marketCap(c))}</Td>
                <Td className="text-right tabular">{money(revenueTTM(c))}</Td>
                <Td className="text-right tabular">{int(c.headcount)}</Td>
                <Td className="text-right tabular">{Math.round(c.reputation)}</Td>
                <Td className="text-right tabular">{num(companyCcu(w, c.id))}</Td>
                <Td className="text-right tabular text-sub">
                  {liveGamesOf(w, c.id).length} live · {devGamesOf(w, c.id).length} dev
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-6 text-center text-sm text-muted">No studios here yet.</div>}
      </div>
    </div>
  );
}

export function CompanyDetail({ id }: { id: string }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const c = w.companies[id];
  const me = playerCompany(w);
  const [trade, setTrade] = useState<'buy' | 'sell' | null>(null);
  const [acq, setAcq] = useState(false);
  if (!c) return <Empty title="Company not found" />;
  const live = liveGamesOf(w, c.id).sort((a, b) => b.ccu - a.ccu);
  const dev = devGamesOf(w, c.id).sort((a, b) => b.hype - a.hype);
  const past = Object.values(w.games)
    .filter((g) => g.companyId === c.id && (g.status === 'shutdown' || g.status === 'retired'))
    .sort((a, b) => (b.releaseDay ?? 0) - (a.releaseDay ?? 0))
    .slice(0, 12);
  const holding = me.holdings[c.id];
  const subs = Object.values(w.companies).filter((s) => s.parentId === c.id && s.status === 'active');
  const quote = acquisitionQuote(w, c.id);
  const mine = c.parentId === me.id;
  const monthRows = c.monthly.slice(-24).map((m) => ({ label: m.label, revenue: m.revenue }));

  return (
    <div className="space-y-4">
      <SectionTitle
        actions={
          c.status === 'active' && !c.parentId ? (
            <>
              {c.isPublic && (
                <>
                  <Button onClick={() => setTrade('buy')}>
                    <ShoppingCart size={14} /> Buy shares
                  </Button>
                  {holding && <Button onClick={() => setTrade('sell')}>Sell shares</Button>}
                </>
              )}
              <Button variant="primary" onClick={() => setAcq(true)}>
                <Handshake size={14} /> Acquire
              </Button>
            </>
          ) : undefined
        }
      >
        <span className="flex items-center gap-2.5">
          <CompanyDot color={c.color} size={14} />
          {c.name}
        </span>
      </SectionTitle>
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-sub">
        {statusBadge(w, c)}
        <Badge>{STRATEGIES[c.strategy].name}</Badge>
        <span>
          CEO {c.ceo} · {c.hq} · founded {date(c.founded)}
        </span>
      </div>
      <p className="text-sm text-muted">{STRATEGIES[c.strategy].blurb} Known for {c.specialties.map((s) => GENRES[s].name).join(', ')}.</p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label={c.isPublic ? 'Market cap' : 'Valuation'} value={money(marketCap(c))} />
        <Stat label="Revenue (TTM)" value={money(revenueTTM(c))} />
        <Stat label="Cash" value={money(c.cash)} tone={c.cash < 0 ? 'bad' : undefined} />
        <Stat label="Debt" value={money(debtOf(c))} />
        <Stat label="Employees" value={int(c.headcount)} sub={`talent ${Math.round(c.talent)}`} />
        <Stat label="Reputation" value={Math.round(c.reputation)} />
        <Stat label="Players online" value={<LiveNumber value={companyCcu(w, c.id)} format={(n) => num(n)} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Monthly revenue">
          <StackedBars rows={monthRows} keys={[{ key: 'revenue', name: 'Revenue', color: '#199e70' }]} format={(n) => money(n)} />
        </Card>
        <Card title={c.isPublic ? 'Share price' : 'Estimated valuation'}>
          {c.isPublic ? (
            <TimeChart series={[{ key: 'p', name: 'Share price', color: '#3987e5', data: c.priceHistory }]} format={(n) => `$${n.toFixed(2)}`} area={false} yDomain={['auto', 'auto']} />
          ) : (
            <TimeChart series={[{ key: 'v', name: 'Valuation', color: '#3987e5', data: c.valuationHistory }]} format={(n) => money(n)} area={false} yDomain={['auto', 'auto']} />
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={`Live games (${live.length})`} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line-soft">
                <tr>
                  <Th>Game</Th>
                  <Th className="text-center">Score</Th>
                  <Th className="text-right">Online</Th>
                  <Th className="text-right">Owners</Th>
                  <Th className="text-right">Rev 30d</Th>
                  <Th>Released</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {live.slice(0, 15).map((g) => (
                  <tr key={g.id} className="hover:bg-surface-2/50">
                    <Td>
                      <div className="font-medium">{g.title}</div>
                      <div className="text-[11px] text-muted">
                        {SCOPES[g.scope].name} {GENRES[g.genre].name} · {MONETIZATIONS[g.monetization].short}
                      </div>
                    </Td>
                    <Td className="text-center">
                      <ScoreBadge score={g.criticScore} />
                    </Td>
                    <Td className="text-right tabular">{num(g.ccu)}</Td>
                    <Td className="text-right tabular text-sub">{num(g.owners)}</Td>
                    <Td className="text-right tabular">{money(g.rev30)}</Td>
                    <Td className="text-xs text-muted">{date(g.releaseDay ?? 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {live.length === 0 && <div className="p-4 text-sm text-muted">No live games.</div>}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Ownership">
            <Kv k="Founders & insiders" v={pct(founderStake(c), 1)} />
            <Kv k="Investors" v={pct(c.shares > 0 ? c.investorShares / c.shares : 0, 1)} />
            {c.isPublic && <Kv k="Public float" v={pct(c.shares > 0 ? floatShares(w, c) / c.shares : 0, 1)} />}
            {holding && <Kv k="Your stake" v={`${pct(holding.shares / c.shares, 2)} · ${money(holding.shares * c.price)}`} tone="good" />}
            {c.isPublic && <Kv k="Shares outstanding" v={num(c.shares)} />}
          </Card>
          <Card title={`In development (${dev.length})`} pad={false}>
            <div className="divide-y divide-line-soft">
              {dev.slice(0, 8).map((g) => (
                <div key={g.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{g.title}</div>
                    <div className="text-[11px] text-muted">
                      {SCOPES[g.scope].name} {GENRES[g.genre].name}
                    </div>
                  </div>
                  <span className="text-xs text-sub">{Math.round(g.hype)} hype</span>
                </div>
              ))}
              {dev.length === 0 && <div className="p-4 text-sm text-muted">Nothing announced.</div>}
            </div>
          </Card>
        </div>
      </div>

      {mine && <SubsidiaryPanel c={c} />}

      {(subs.length > 0 || past.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {subs.length > 0 && (
            <Card title="Subsidiaries" pad={false}>
              <div className="divide-y divide-line-soft">
                {subs.map((s) => (
                  <button key={s.id} onClick={() => navigate({ name: 'company', id: s.id })} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-surface-2">
                    <span className="flex items-center gap-2">
                      <CompanyDot color={s.color} />
                      {s.name}
                    </span>
                    <span className="tabular text-sub">{money(s.valuation)}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
          {past.length > 0 && (
            <Card title="Past games" pad={false}>
              <div className="divide-y divide-line-soft">
                {past.map((g) => (
                  <div key={g.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="truncate">{g.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {money(g.revenueTotal)} <ScoreBadge score={g.criticScore} />
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <TradeModal c={c} mode={trade} onClose={() => setTrade(null)} />
      <Modal
        open={acq}
        onClose={() => setAcq(false)}
        title={`Acquire ${c.name}`}
        footer={
          <>
            <Button onClick={() => setAcq(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!!quote.blocker}
              onClick={() => {
                const r = act((world) => acquire(world, c.id));
                if (r.ok) setAcq(false);
              }}
            >
              <Briefcase size={14} /> Pay {money(quote.price)}
            </Button>
          </>
        }
      >
        <p className="text-sm text-sub">{quote.note}</p>
        <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <Kv k="Price" v={money(quote.price)} />
          <Kv k="Your cash" v={money(me.cash)} tone={me.cash < quote.price ? 'bad' : undefined} />
          <Kv k="Their cash" v={money(c.cash)} />
          <Kv k="Their debt (you inherit it)" v={money(debtOf(c))} />
          <Kv k="Staff" v={int(c.headcount)} />
          <Kv k="Live games" v={live.length} />
        </div>
        <p className="mt-3 text-xs text-muted">
          Acquired studios become subsidiaries. They keep developing games under AI management with the strategy you choose; their excess cash flows up to you and their value counts toward yours.
        </p>
        {quote.blocker && <p className="mt-2 text-sm text-bad">{quote.blocker}</p>}
      </Modal>
    </div>
  );
}

function TradeModal({ c, mode, onClose }: { c: Company; mode: 'buy' | 'sell' | null; onClose: () => void }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const me = playerCompany(w);
  const [shares, setShares] = useState(0);
  if (!mode) return null;
  const holding = me.holdings[c.id];
  const max = mode === 'buy' ? Math.floor(Math.min(floatShares(w, c), me.cash / (c.price * 1.05))) : Math.floor(holding?.shares ?? 0);
  const cost = shares > 0 ? tradeCost(w, c, shares) : { price: c.price, total: 0 };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${mode === 'buy' ? 'Buy' : 'Sell'} ${c.name} shares`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={shares <= 0 || shares > max}
            onClick={() => {
              const r = act((world) => (mode === 'buy' ? buyStock(world, c.id, shares) : sellStock(world, c.id, shares)), mode === 'buy' ? 'Shares purchased' : 'Shares sold');
              if (r.ok) onClose();
            }}
          >
            {mode === 'buy' ? 'Buy' : 'Sell'} {num(shares)} shares
          </Button>
        </>
      }
    >
      <Kv k="Share price" v={`$${c.price.toFixed(2)}`} />
      <Kv k={mode === 'buy' ? 'Available to buy' : 'You own'} v={num(max)} />
      {holding && <Kv k="Your average cost" v={`$${(holding.cost / holding.shares).toFixed(2)}`} />}
      <div className="mt-3 flex gap-2">
        <input type="number" className={inputClass} value={shares || ''} min={0} max={max} onChange={(e) => setShares(Math.max(0, Math.floor(Number(e.target.value))))} placeholder="Number of shares" />
        <Button onClick={() => setShares(max)}>Max</Button>
      </div>
      <input type="range" min={0} max={max} value={Math.min(shares, max)} onChange={(e) => setShares(Number(e.target.value))} className="mt-3 w-full" />
      <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2">
        <Kv k="Est. execution price" v={`$${cost.price.toFixed(2)}`} />
        <Kv k={mode === 'buy' ? 'Total cost' : 'Proceeds (approx.)'} v={money(mode === 'buy' ? cost.total : shares * c.price * 0.98)} />
      </div>
      <p className="mt-2 text-[11px] text-muted">Large orders move the price against you.</p>
    </Modal>
  );
}

function SubsidiaryPanel({ c }: { c: Company }) {
  const act = useGameStore((s) => s.act);
  const [amount, setAmount] = useState(1_000_000);
  return (
    <Card title="Manage subsidiary" subtitle="Your studio. It runs itself, guided by the strategy you set.">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium text-sub">Strategy</div>
          <div className="grid grid-cols-2 gap-1.5">
            {STRATEGY_IDS.map((s: StrategyId) => (
              <button
                key={s}
                onClick={() => act((world) => setSubsidiaryStrategy(world, c.id, s), `${c.name} now follows ${STRATEGIES[s].name}`)}
                className={cx('rounded-md border px-2 py-1.5 text-left text-xs', c.strategy === s ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface-2 hover:border-sub')}
              >
                <div className="font-semibold">{STRATEGIES[s].name}</div>
                <div className="text-[10px] text-muted">{STRATEGIES[s].blurb}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-sub">Move cash</div>
          <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} />
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => act((world) => transferToSubsidiary(world, c.id, amount), 'Cash transferred')}>
              Invest in {c.name}
            </Button>
            <Button size="sm" onClick={() => act((world) => transferToSubsidiary(world, c.id, -amount), 'Dividend received')}>
              Take dividend
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">Excess cash above six months of costs is swept to you automatically each month.</p>
        </div>
      </div>
    </Card>
  );
}
