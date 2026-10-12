import { useState } from 'react';
import { Banknote, Landmark, Rocket, TrendingUp } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { creditRisk, debtOf, loanOffers, monthlyBurn, profitTTM, revenueTTM } from '../../engine/finance';
import {
  acceptFunding,
  declineFunding,
  fundingBlocker,
  goPublic,
  ipoBlocker,
  nextFundingRound,
  pitchInvestors,
  repayLoan,
  setAutoSupport,
  takeLoanOffer,
} from '../../engine/actions';
import { floatShares, founderStake, marketCap } from '../../engine/stocks';
import { EXPENSE_KEYS, REVENUE_KEYS, ledgerExpenses, ledgerRevenue, playerCompany } from '../../engine/util';
import type { Ledger } from '../../engine/types';
import { date, money, pct } from '../lib/format';
import { Donut, StackedBars, TimeChart } from '../components/charts';
import { Badge, Button, Card, CompanyDot, Kv, Progress, SectionTitle, Stat, Td, Th, cx } from '../components/ui';

const REV_LABELS: Record<(typeof REVENUE_KEYS)[number], string> = {
  sales: 'Game sales',
  microtransactions: 'Microtransactions',
  subscriptions: 'Subscriptions',
  ads: 'Advertising',
  dlc: 'DLC',
  licensing: 'Licensing & merch',
  contracts: 'Client contracts',
  investments: 'Investment income',
  publishing: 'Publishing deals',
  other: 'Other',
};
const EXP_LABELS: Record<(typeof EXPENSE_KEYS)[number], string> = {
  salaries: 'Salaries',
  rent: 'Rent',
  servers: 'Servers',
  development: 'Dev budgets',
  marketing: 'Marketing',
  royalties: 'Royalties & cuts',
  interest: 'Interest',
  taxes: 'Taxes',
  research: 'R&D',
  perks: 'Benefits & perks',
  misc: 'Other',
};
const REV_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#5b6878', '#8a96a3'];
const EXP_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#5b6878', '#6f7c8b', '#8a96a3'];

export function Finance() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const offers = loanOffers(w, c);
  const rev = revenueTTM(c);
  const profit = profitTTM(c);
  const months = c.monthly.slice(-18);
  const revRows = months.map((m) => {
    const row: Record<string, number | string> = { label: m.label };
    for (const k of REVENUE_KEYS) row[k] = m.ledger[k];
    return row;
  });
  const expRows = months.map((m) => {
    const row: Record<string, number | string> = { label: m.label };
    for (const k of EXPENSE_KEYS) row[k] = m.ledger[k];
    return row;
  });
  const usedRev = REVENUE_KEYS.filter((k) => months.some((m) => m.ledger[k] > 0));
  const usedExp = EXPENSE_KEYS.filter((k) => months.some((m) => m.ledger[k] > 0));
  const stake = founderStake(c);

  return (
    <div className="space-y-4">
      <SectionTitle>Finance</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Cash" value={money(c.cash)} tone={c.cash < 0 ? 'bad' : undefined} icon={<Banknote size={13} />} />
        <Stat label="Debt" value={money(debtOf(c))} />
        <Stat label="Revenue (TTM)" value={money(rev)} />
        <Stat label="Profit (TTM)" value={money(profit)} tone={profit >= 0 ? 'good' : 'bad'} />
        <Stat label="Monthly costs" value={money(monthlyBurn(w, c))} />
        <Stat label={c.isPublic ? 'Market cap' : 'Valuation'} value={money(marketCap(c))} icon={<TrendingUp size={13} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Revenue by month" subtitle="After platform store cuts">
          <StackedBars rows={revRows} keys={usedRev.map((k) => ({ key: k, name: REV_LABELS[k], color: REV_COLORS[REVENUE_KEYS.indexOf(k)] }))} format={(n) => money(n)} />
        </Card>
        <Card title="Expenses by month">
          <StackedBars rows={expRows} keys={usedExp.map((k) => ({ key: k, name: EXP_LABELS[k], color: EXP_COLORS[EXPENSE_KEYS.indexOf(k)] }))} format={(n) => money(n)} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Profit & loss" pad={false}>
          <PnlTable current={c.ledger} months={c.monthly.slice(-5)} />
        </Card>
        <Card title="Cash balance">
          <TimeChart series={[{ key: 'c', name: 'Cash', color: '#199e70', data: c.cashHistory }]} format={(n) => money(n)} height={230} yDomain={['auto', 'auto']} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Bank loans" subtitle={`Credit risk premium ${pct(creditRisk(w, c), 1)} over the ${pct(w.market.baseRate, 1)} base rate`}>
          {c.loans.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-lg border border-line">
              <table className="w-full">
                <thead className="border-b border-line-soft">
                  <tr>
                    <Th>Lender</Th>
                    <Th className="text-right">Balance</Th>
                    <Th className="text-right">APR</Th>
                    <Th className="text-right">Monthly</Th>
                    <Th className="text-right">Left</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {c.loans.map((l) => (
                    <tr key={l.id}>
                      <Td>{l.lender}</Td>
                      <Td className="text-right tabular">{money(l.balance)}</Td>
                      <Td className="text-right tabular">{pct(l.apr, 1)}</Td>
                      <Td className="text-right tabular">{money(l.monthlyPayment)}</Td>
                      <Td className="text-right tabular">{l.monthsLeft} mo</Td>
                      <Td className="text-right">
                        <Button size="sm" disabled={c.cash < l.balance} onClick={() => act((world) => repayLoan(world, l.id), 'Loan repaid')}>
                          Repay
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {offers.length === 0 ? (
            <p className="text-sm text-muted">No bank will lend to you right now. Build revenue, reputation or reduce debt.</p>
          ) : (
            <div className="space-y-2">
              {offers.map((o, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <Landmark size={16} className="text-accent" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{money(o.amount)}</div>
                    <div className="text-xs text-muted">
                      {pct(o.apr, 1)} APR · {o.months} months · {money(o.monthlyPayment)}/mo
                    </div>
                  </div>
                  <Button size="sm" onClick={() => act((world) => takeLoanOffer(world, i), `Borrowed ${money(o.amount)}`)}>
                    Borrow
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted">Payments are taken monthly. Missing payments while cash is negative damages your credit. After 90 days of negative cash you go bankrupt, but an angel investor offers a lifeline first.</p>
        </Card>

        <Funding />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Ipo />
        <Card title="Ownership & board">
          <Donut
            height={170}
            format={(n) => pct(n, 1)}
            slices={[
              { name: w.player.founderName === 'You' ? 'You (founder)' : `${w.player.founderName} (you)`, value: stake, color: '#3987e5' },
              { name: 'Venture investors', value: c.shares > 0 ? c.investorShares / c.shares : 0, color: '#d95926' },
              { name: 'Public shareholders', value: c.isPublic && c.shares > 0 ? floatShares(w, c) / c.shares : 0, color: '#199e70' },
            ].filter((s) => s.value > 0)}
          />
          {stake < 0.999 && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-sub">Board confidence</span>
                <span className={cx('font-semibold tabular', c.boardConfidence < 30 ? 'text-bad' : c.boardConfidence < 50 ? 'text-warn' : 'text-good')}>{Math.round(c.boardConfidence)}%</span>
              </div>
              <Progress value={c.boardConfidence} max={100} tone={c.boardConfidence < 30 ? 'bad' : c.boardConfidence < 50 ? 'warn' : 'good'} />
              <p className="mt-2 text-xs text-muted">
                {stake >= 0.5
                  ? 'You hold a majority, so the board cannot fire you — but investors still watch profitability and the share price.'
                  : 'You no longer control a majority. If board confidence falls below 15%, you can be voted out. Public companies without majority control are exposed to hostile takeovers.'}
              </p>
            </div>
          )}
        </Card>
      </div>

      <Subsidiaries />
    </div>
  );
}

function PnlTable({ current, months }: { current: Ledger; months: { label: string; ledger: Ledger }[] }) {
  const cols = [...months.map((m) => ({ label: m.label, l: m.ledger })), { label: 'This month', l: current }];
  const revKeys = REVENUE_KEYS.filter((k) => cols.some((c) => c.l[k] > 0));
  const expKeys = EXPENSE_KEYS.filter((k) => cols.some((c) => c.l[k] > 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-line-soft">
          <tr>
            <Th />
            {cols.map((c) => (
              <Th key={c.label} className="text-right">
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {revKeys.map((k) => (
            <tr key={k}>
              <Td className="text-sub">{REV_LABELS[k]}</Td>
              {cols.map((c) => (
                <Td key={c.label} className="text-right tabular">
                  {money(c.l[k])}
                </Td>
              ))}
            </tr>
          ))}
          <tr className="border-y border-line-soft">
            <Td className="font-semibold">Revenue</Td>
            {cols.map((c) => (
              <Td key={c.label} className="text-right font-semibold tabular text-good">
                {money(ledgerRevenue(c.l))}
              </Td>
            ))}
          </tr>
          {expKeys.map((k) => (
            <tr key={k}>
              <Td className="text-sub">{EXP_LABELS[k]}</Td>
              {cols.map((c) => (
                <Td key={c.label} className="text-right tabular">
                  {money(-c.l[k])}
                </Td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-line-soft">
            <Td className="font-semibold">Net profit</Td>
            {cols.map((c) => {
              const p = ledgerRevenue(c.l) - ledgerExpenses(c.l);
              return (
                <Td key={c.label} className={cx('text-right font-semibold tabular', p >= 0 ? 'text-good' : 'text-bad')}>
                  {money(p)}
                </Td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Funding() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const round = nextFundingRound(w);
  const blocker = fundingBlocker(w);
  const offers = w.player.fundingOffers.filter((o) => o.expiresDay >= w.day);
  return (
    <Card title="Venture capital" subtitle="Sell equity for cash. Investors expect growth and gain a say on the board.">
      {c.isPublic ? (
        <p className="text-sm text-muted">You're public now — raise money through share offerings in the Stock Market.</p>
      ) : (
        <>
          <Kv k="Next round" v={round?.name ?? 'None'} />
          <Kv k="Current valuation" v={money(c.valuation)} />
          <Kv k="Rounds raised" v={w.player.fundingRoundsTaken} />
          {offers.length > 0 ? (
            <div className="mt-3 space-y-2">
              {offers.map((o) => (
                <div key={o.id} className="rounded-lg border border-accent/40 bg-accent-soft/30 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">
                        {o.investor} · {o.round}
                      </div>
                      <div className="text-xs text-sub">
                        {money(o.amount)} for {pct(o.equity, 1)} · {money(o.preMoney)} pre-money · expires {date(o.expiresDay)}
                      </div>
                    </div>
                    <Button size="sm" variant="primary" onClick={() => act((world) => acceptFunding(world, o.id))}>
                      Accept
                    </Button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => act(declineFunding)}>
                Decline all
              </Button>
            </div>
          ) : (
            <>
              {blocker && <p className="mt-3 text-sm text-warn">{blocker}</p>}
              <Button className="mt-3" variant="primary" disabled={!!blocker} onClick={() => act(pitchInvestors, 'Investors are reviewing your pitch')}>
                Pitch investors
              </Button>
            </>
          )}
          <p className="mt-3 text-[11px] text-muted">Every round dilutes your stake. Drop below 50% and you can lose control of your company.</p>
        </>
      )}
    </Card>
  );
}

function Ipo() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const [float, setFloat] = useState(0.2);
  if (c.isPublic) {
    return (
      <Card title="Public company" subtitle={`Listed since ${date(c.ipoDay ?? 0)}`}>
        <Kv k="Share price" v={`$${c.price.toFixed(2)}`} />
        <Kv k="Market cap" v={money(marketCap(c))} />
        <Kv k="Next earnings expectation" v={money(c.expectedQuarter)} />
        <Kv k="Quarter so far" v={money(c.quarterRevenue)} tone={c.quarterRevenue >= c.expectedQuarter ? 'good' : 'warn'} />
        <p className="mt-2 text-[11px] text-muted">Each quarter the market compares your revenue with expectations. Misses send the stock down.</p>
      </Card>
    );
  }
  const blocker = ipoBlocker(w);
  const raise = c.valuation * (float / (1 - float));
  return (
    <Card title="Initial public offering" subtitle="List on the stock market: raise a lot of cash, but answer to shareholders every quarter.">
      <div className="space-y-1 text-sm">
        {[
          ['$50M valuation', c.valuation >= 50e6],
          ['$10M trailing revenue', revenueTTM(c) >= 10e6],
          ['Reputation 35', c.reputation >= 35],
          ['3 released games', w.player.stats.gamesReleased >= 3],
        ].map(([label, ok]) => (
          <div key={String(label)} className="flex items-center gap-2">
            <span className={cx('h-2 w-2 rounded-full', ok ? 'bg-good' : 'bg-line')} />
            <span className={ok ? 'text-ink' : 'text-muted'}>{label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-sub">
          <span>Shares offered to the public</span>
          <span className="tabular">{pct(float)}</span>
        </div>
        <input type="range" min={0.1} max={0.4} step={0.01} value={float} onChange={(e) => setFloat(Number(e.target.value))} className="w-full" />
        <div className="mt-1 text-xs text-muted">Raises roughly {money(raise)} (before 7% underwriting fees)</div>
      </div>
      <Button className="mt-3" variant="primary" disabled={!!blocker} onClick={() => act((world) => goPublic(world, float))}>
        <Rocket size={14} /> Ring the bell
      </Button>
      {blocker && <p className="mt-2 text-xs text-warn">{blocker}</p>}
    </Card>
  );
}

function Subsidiaries() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const navigate = useGameStore((s) => s.navigate);
  const subs = Object.values(w.companies).filter((x) => x.parentId === w.player.companyId && x.status === 'active');
  if (subs.length === 0) return null;
  return (
    <Card
      title="Subsidiaries"
      subtitle="Studios you own"
      actions={
        <label className="flex items-center gap-2 text-xs text-sub">
          <input type="checkbox" checked={w.player.autoSupportSubsidiaries} onChange={(e) => act((world) => setAutoSupport(world, e.target.checked))} />
          Auto-bailout when they run out of cash
        </label>
      }
      pad={false}
    >
      <div className="divide-y divide-line-soft">
        {subs.map((s) => (
          <button key={s.id} onClick={() => navigate({ name: 'company', id: s.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2">
            <CompanyDot color={s.color} />
            <span className="flex-1 font-medium">{s.name}</span>
            <Badge>{s.headcount} staff</Badge>
            <span className="w-24 text-right tabular text-sub">{money(s.cash)} cash</span>
            <span className="w-24 text-right tabular">{money(revenueTTM(s))} TTM</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
