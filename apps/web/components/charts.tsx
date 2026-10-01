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
import { formatTs } from '@/lib/format';

export function Sparkline({ points, color }: { points: Array<{ t: string; v: number }>; color: string }) {
  return (
    <div className="spark">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            dot={false}
            isAnimationActive={false}
            strokeWidth={1.75}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HistoryChart({
  rows,
  channels,
  names,
}: {
  rows: Array<Record<string, string | number>>;
  channels: number[];
  names: string[];
}) {
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#2c3644" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            tickFormatter={(v) => formatTs(String(v))}
            stroke="#8b9bb0"
            tick={{ fill: '#8b9bb0', fontSize: 13 }}
            minTickGap={24}
          />
          <YAxis
            stroke="#8b9bb0"
            tick={{ fill: '#8b9bb0', fontSize: 13 }}
            width={56}
            unit="°"
          />
          <Tooltip
            contentStyle={{ background: '#1b232e', border: '1px solid #2c3644', fontSize: 14, borderRadius: 6 }}
            labelFormatter={(v) => String(v)}
            formatter={(value, name) => {
              const n = Number(value);
              return [`${Number.isFinite(n) ? n.toFixed(2) : '—'} °C`, String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 14 }} />
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
