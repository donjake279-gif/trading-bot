// Chart wrappers. Conventions: one y-axis, 2px lines, ~10% area wash,
// hairline recessive grid, hover crosshair + tooltip, legend for 2+ series.
import { useMemo, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS, GRID, OTHER } from '../lib/format';
import { formatDate, formatMonth } from '../../engine/util';

export interface Series {
  key: string;
  name: string;
  color: string;
  data: [number, number][];
}

interface TipPayload {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: Record<string, unknown>;
}

function TipBox({ title, rows }: { title: ReactNode; rows: { name: string; color: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-sub">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-sub">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
            {r.name}
          </span>
          <span className="font-semibold tabular text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: i.color, height: 3 }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

function mergeSeries(series: Series[]): Record<string, number>[] {
  const rows = new Map<number, Record<string, number>>();
  for (const s of series) {
    for (const [d, v] of s.data) {
      let row = rows.get(d);
      if (!row) rows.set(d, (row = { day: d }));
      row[s.key] = v;
    }
  }
  return [...rows.values()].sort((a, b) => a.day - b.day);
}

export function TimeChart({
  series,
  height = 220,
  format,
  area = true,
  domainMin,
  yDomain,
}: {
  series: Series[];
  height?: number;
  format: (n: number) => string;
  area?: boolean;
  domainMin?: number;
  yDomain?: [number | 'auto', number | 'auto'];
}) {
  const data = useMemo(() => {
    const merged = mergeSeries(series);
    return domainMin !== undefined ? merged.filter((r) => r.day >= domainMin) : merged;
  }, [series, domainMin]);
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-muted" style={{ height }}>
        Not enough history yet
      </div>
    );
  }
  const span = data[data.length - 1].day - data[0].day;
  const tickFmt = (d: number) => (span > 500 ? formatMonth(d) : formatDate(d).replace(/, \d{4}$/, ''));
  const tooltip = ({ active, payload, label }: { active?: boolean; payload?: readonly TipPayload[]; label?: string | number }) => {
    if (!active || !payload?.length) return null;
    return (
      <TipBox
        title={formatDate(Number(label))}
        rows={payload
          .filter((p) => p.value !== undefined)
          .map((p) => {
            const s = series.find((x) => x.key === p.dataKey);
            return { name: s?.name ?? String(p.name), color: s?.color ?? '#888', value: format(Number(p.value)) };
          })}
      />
    );
  };
  const common = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
      <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tickFmt} stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={40} />
      <YAxis tickFormatter={format} stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={58} domain={yDomain ?? [0, 'auto']} />
      <Tooltip content={tooltip} cursor={{ stroke: AXIS, strokeWidth: 1 }} isAnimationActive={false} />
    </>
  );
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        {area ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {common}
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.1}
                isAnimationActive={false}
                connectNulls
                dot={false}
                activeDot={{ r: 4, stroke: '#131a24', strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {common}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
                dot={false}
                activeDot={{ r: 4, stroke: '#131a24', strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
      {series.length > 1 && <Legend items={series} />}
    </div>
  );
}

/** Tiny inline SVG sparkline - cheap enough for table rows. */
export function Sparkline({ data, color = '#3987e5', width = 96, height = 26 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / range) * (height - 6)}`);
  const last = pts[pts.length - 1].split(',');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

export interface Slice {
  name: string;
  value: number;
  color: string;
}

export function Donut({ slices, format, height = 200 }: { slices: Slice[]; format: (n: number) => string; height?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const tooltip = ({ active, payload }: { active?: boolean; payload?: readonly TipPayload[] }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0];
    return <TipBox title={String(p.name)} rows={[{ name: 'Share', color: String(p.payload?.fill ?? '#888'), value: `${format(Number(p.value))} · ${((Number(p.value) / total) * 100).toFixed(1)}%` }]} />;
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="95%" stroke="#131a24" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={tooltip} isAnimationActive={false} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {slices.map((s) => (
          <div key={s.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-sub">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="tabular text-ink">{total > 0 ? ((s.value / total) * 100).toFixed(1) : '0'}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fold a long list into the top N slices + "Other", colouring in fixed order. */
export function foldSlices(items: { name: string; value: number }[], palette: string[], top = 7): Slice[] {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, top).map((i, idx) => ({ ...i, color: palette[idx % palette.length] }));
  const rest = sorted.slice(top).reduce((s, i) => s + i.value, 0);
  if (rest > 0) head.push({ name: 'Other', value: rest, color: OTHER });
  return head;
}

export function StackedBars({
  rows,
  keys,
  format,
  height = 220,
}: {
  rows: Record<string, number | string>[];
  keys: { key: string; name: string; color: string }[];
  format: (n: number) => string;
  height?: number;
}) {
  const tooltip = ({ active, payload, label }: { active?: boolean; payload?: readonly TipPayload[]; label?: string | number }) => {
    if (!active || !payload?.length) return null;
    return (
      <TipBox
        title={label}
        rows={payload
          .filter((p) => Number(p.value) !== 0)
          .map((p) => {
            const k = keys.find((x) => x.key === p.dataKey);
            return { name: k?.name ?? String(p.name), color: k?.color ?? '#888', value: format(Number(p.value)) };
          })}
      />
    );
  };
  if (rows.length === 0) return <div className="flex items-center justify-center text-xs text-muted" style={{ height }}>No closed months yet</div>;
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={8} />
          <YAxis tickFormatter={format} stroke={AXIS} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={tooltip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} isAnimationActive={false} />
          {keys.map((k, i) => (
            <Bar key={k.key} dataKey={k.key} stackId="a" fill={k.color} maxBarSize={24} stroke="#131a24" strokeWidth={1} isAnimationActive={false} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {keys.length > 1 && <Legend items={keys} />}
    </div>
  );
}
