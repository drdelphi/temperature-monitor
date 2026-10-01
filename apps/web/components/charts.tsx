'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { channelHue } from '@/lib/colors';
import { dayAxisTicks, formatDayAxisTick, formatTs, formatTsFull } from '@/lib/format';
import { useNarrowViewport } from '@/lib/use-narrow';

function asTimeMs(value: string | number): number {
  if (typeof value === 'number') return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NaN;
}

export function HistoryChart({
  rows,
  channels,
  names,
  className,
  tickFormatter = formatTs,
  xDomain,
}: {
  rows: Array<Record<string, string | number>>;
  channels: number[];
  names: string[];
  className?: string;
  tickFormatter?: (value: string) => string;
  xDomain?: [number, number];
}) {
  const narrow = useNarrowViewport();
  const data = xDomain
    ? rows.map((row) => {
        const t = asTimeMs(row.t);
        return Number.isFinite(t) ? { ...row, t } : row;
      })
    : rows;
  const ticks = xDomain ? dayAxisTicks(xDomain[0], xDomain[1], data.map((row) => row.t)) : undefined;
  /* A phone has room for the lines or the furniture, not both. */
  const axisTick = { fill: '#8b9bb0', fontSize: narrow ? 11 : 13 };

  return (
    <div className={['chart-box', className].filter(Boolean).join(' ')}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: narrow ? 6 : 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#2c3644" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type={xDomain ? 'number' : 'category'}
            domain={xDomain}
            ticks={ticks}
            scale={xDomain ? 'linear' : undefined}
            allowDataOverflow={Boolean(xDomain)}
            tickFormatter={(v) =>
              xDomain
                ? formatDayAxisTick(asTimeMs(v as string | number), xDomain[1])
                : tickFormatter(String(v))
            }
            stroke="#8b9bb0"
            tick={axisTick}
            minTickGap={narrow ? 44 : 24}
          />
          <YAxis
            stroke="#8b9bb0"
            tick={axisTick}
            width={narrow ? 38 : 56}
            unit="°"
          />
          <Tooltip
            contentStyle={{
              background: '#1b232e',
              border: '1px solid #2c3644',
              fontSize: narrow ? 13 : 14,
              borderRadius: 6,
            }}
            labelFormatter={(v) => {
              const ms = asTimeMs(v as string | number);
              return Number.isFinite(ms) ? formatTsFull(new Date(ms).toISOString()) : formatTsFull(String(v));
            }}
            formatter={(value, name) => {
              const n = Number(value);
              return [`${Number.isFinite(n) ? n.toFixed(2) : '—'} °C`, String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: narrow ? 12 : 14 }} />
          {channels.map((ch) => (
            <Line
              key={ch}
              type="monotone"
              dataKey={`c${ch}`}
              name={names[ch] ?? `Sensor ${ch + 1}`}
              stroke={channelHue(ch)}
              dot={false}
              isAnimationActive={false}
              strokeWidth={2}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
