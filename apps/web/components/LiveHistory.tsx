'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, CHANNEL_COUNT, SAMPLE_WARN_COUNT } from '@/lib/config';
import { apiBlob, apiGet, queryString } from '@/lib/api';
import { channelHue } from '@/lib/colors';
import {
  errorMessage,
  formatTemp,
  isoFilenameStamp,
  liveDayDomain,
  startOfLocalDay,
  toLocalInput,
} from '@/lib/format';
import { useForegroundRefresh, useVisiblePolling } from '@/lib/poll';
import { asRecord, type Channel, type Device, type Sample, normalizeSamples } from '@/lib/types';
import { chartBucketSec, historyRows, liveChartSamples, mergeDaySamples, mergeSamples, coerceLiveTs } from '@/lib/samples';
import { liveStreamUrl, openLiveStream } from '@/lib/ws';
import { Button, ErrorText } from './ui';

/* Recharts is the heaviest thing on the page. Loading it on its own lets a phone
   paint and answer taps while the chart code is still coming down. */
const HistoryChart = dynamic(() => import('./charts').then((m) => m.HistoryChart), {
  ssr: false,
  loading: () => <div className="chart-box busy">Drawing the chart…</div>,
});

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 3600_000);
  return { from: toLocalInput(from), to: toLocalInput(to) };
}

function countFrom(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const n = asRecord(raw).count;
  return typeof n === 'number' ? n : Number(n) || 0;
}

function enabledChannels(channels: Channel[]): Channel[] {
  return channels.filter((c) => c.enabled);
}

function enabledIndexMask(channels: Channel[]): string {
  return Array.from({ length: CHANNEL_COUNT }, (_, i) => (channels[i]?.enabled ? '1' : '0')).join('');
}

function selectedEnabledIndexes(selected: boolean[], enabledMask: string): number[] {
  return selected.map((on, i) => (on && enabledMask[i] === '1' ? i : -1)).filter((i) => i >= 0);
}

function ChannelPicks({
  channels,
  selected,
  onChange,
}: {
  channels: Channel[];
  selected: boolean[];
  onChange: (next: boolean[]) => void;
}) {
  const indexes = channels.map((c) => c.index);
  const allOn = indexes.length > 0 && indexes.every((i) => selected[i]);
  const someOn = indexes.some((i) => selected[i]);

  function setAll(value: boolean) {
    const next = [...selected];
    for (const i of indexes) next[i] = value;
    onChange(next);
  }

  return (
    <div className="row channel-picks">
      <label className="check check-all" title="All sensors">
        <input
          type="checkbox"
          checked={allOn}
          ref={(el) => {
            if (el) el.indeterminate = someOn && !allOn;
          }}
          onChange={() => setAll(!allOn)}
        />
        <span className="check-name">All</span>
      </label>
      {channels.map((c) => (
        <label key={c.index} className="check" title={c.name}>
          <input
            type="checkbox"
            checked={selected[c.index] ?? false}
            onChange={() => onChange(selected.map((on, i) => (i === c.index ? !on : on)))}
          />
          <span className="ch-pip" style={{ background: channelHue(c.index) }} />
          <span className="check-name">{c.name}</span>
        </label>
      ))}
    </div>
  );
}

export function LiveReadings({
  device,
  liveSamples,
}: {
  device: Device;
  liveSamples: Sample[];
}) {
  const liveRef = useRef(liveSamples);
  liveRef.current = liveSamples;

  const [selected, setSelected] = useState<boolean[]>(() =>
    Array.from({ length: CHANNEL_COUNT }, (_, i) => device.channels[i]?.enabled !== false),
  );
  const [hist, setHist] = useState<Sample[]>([]);
  const [bucketSec, setBucketSec] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const enabledMask = enabledIndexMask(device.channels);

  const enabledIdx = useMemo(
    () => selectedEnabledIndexes(selected, enabledMask),
    [selected, enabledMask],
  );

  const loadDay = useCallback(async () => {
    setErr(null);
    try {
      const from = startOfLocalDay();
      const to = new Date();
      const bucket = chartBucketSec(from.getTime(), to.getTime());
      const data = normalizeSamples(
        await apiGet(
          `/v1/samples${queryString({
            deviceId: device.id,
            from: from.toISOString(),
            to: to.toISOString(),
            downsample: String(bucket),
          })}`,
        ),
      );
      setBucketSec(bucket);
      setHist(mergeDaySamples(data, liveRef.current));
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, [device.id]);

  useEffect(() => {
    setHist([]);
    void loadDay();
  }, [loadDay]);

  const dayKey = useRef(startOfLocalDay().toDateString());
  const bucketRef = useRef(bucketSec);
  bucketRef.current = bucketSec;
  const rollDay = useCallback(() => {
    const next = startOfLocalDay().toDateString();
    if (next !== dayKey.current) {
      dayKey.current = next;
      setHist([]);
      void loadDay();
      return;
    }
    /* The day keeps growing under a tab left open, so refetch once it has grown
       past the bucket the points on screen were averaged into. */
    if (chartBucketSec(startOfLocalDay().getTime(), Date.now()) !== bucketRef.current) {
      void loadDay();
    }
  }, [loadDay]);

  useVisiblePolling(rollDay, 30_000);
  /* A phone suspends the live socket in the background, so the chart comes back
     with a hole in it. Refetching the day on return fills it. */
  useForegroundRefresh(loadDay);

  useEffect(() => {
    if (liveSamples.length === 0) return;
    setHist((prev) => mergeDaySamples(prev, liveSamples));
  }, [liveSamples]);

  const rows = historyRows(liveChartSamples(hist, bucketSec), enabledIdx);
  const names = device.channels.map((c) => {
    const temp = formatTemp(c.lastTempC);
    return temp === '—' ? c.name : `${c.name} · ${temp}`;
  });

  return (
    <div className="chart-pane">
      <ChannelPicks channels={enabledChannels(device.channels)} selected={selected} onChange={setSelected} />
      <ErrorText>{err}</ErrorText>
      {enabledIdx.length === 0 ? (
        <div className="empty">Choose at least one sensor.</div>
      ) : (
        <HistoryChart rows={rows} channels={enabledIdx} names={names} xDomain={liveDayDomain(rows[0]?.t)} />
      )}
    </div>
  );
}

export function HistoryReadings({ device }: { device: Device }) {
  const [range, setRange] = useState(defaultRange);
  const [selected, setSelected] = useState<boolean[]>(() =>
    Array.from({ length: CHANNEL_COUNT }, (_, i) => device.channels[i]?.enabled !== false),
  );
  const [hist, setHist] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const enabledMask = enabledIndexMask(device.channels);

  const enabledIdx = useMemo(
    () => selectedEnabledIndexes(selected, enabledMask),
    [selected, enabledMask],
  );

  const loadHistory = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const fromDate = new Date(range.from);
      const toDate = new Date(range.to);
      const from = fromDate.toISOString();
      const to = toDate.toISOString();
      const q = queryString({
        deviceId: device.id,
        from,
        to,
        downsample: String(chartBucketSec(fromDate.getTime(), toDate.getTime())),
        channel: enabledIdx.length === CHANNEL_COUNT ? undefined : enabledIdx.join(','),
      });
      const data = normalizeSamples(await apiGet(`/v1/samples${q}`));
      setHist(data);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [device.id, enabledIdx, range.from, range.to]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function exportXlsx() {
    setErr(null);
    setWarn(null);
    const from = new Date(range.from).toISOString();
    const to = new Date(range.to).toISOString();
    try {
      const count = countFrom(
        await apiGet(
          `/v1/samples/count${queryString({
            deviceId: device.id,
            from,
            to,
            channel: enabledIdx.length === CHANNEL_COUNT ? undefined : enabledIdx.join(','),
          })}`,
        ),
      );
      if (count > SAMPLE_WARN_COUNT) {
        setWarn(`This is a large download (${count} readings).`);
      }
      const q = queryString({
        from,
        to,
        channel: enabledIdx.length === CHANNEL_COUNT ? undefined : enabledIdx.join(','),
      });
      const blob = await apiBlob(`/v1/devices/${encodeURIComponent(device.id)}/export.xlsx${q}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `temp-${device.id}-${isoFilenameStamp(from)}-${isoFilenameStamp(to)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  const rows = historyRows(hist, enabledIdx);
  const names = device.channels.map((c) => c.name);

  return (
    <div className="chart-pane">
      <div className="toolbar">
        <label className="field">
          <span>From</span>
          <input type="datetime-local" step={1} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="datetime-local" step={1} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </label>
        <Button onClick={() => void loadHistory()} disabled={busy}>
          Show
        </Button>
        <Button variant="primary" onClick={() => void exportXlsx()}>
          Export to Excel
        </Button>
      </div>
      <ChannelPicks channels={enabledChannels(device.channels)} selected={selected} onChange={setSelected} />
      <ErrorText>{err}</ErrorText>
      {warn ? <p className="warn-text">{warn}</p> : null}
      {enabledIdx.length === 0 ? (
        <div className="empty">Choose at least one sensor.</div>
      ) : busy && rows.length === 0 ? (
        <div className="chart-box busy">Loading readings…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No readings in this time range.</div>
      ) : (
        <HistoryChart rows={rows} channels={enabledIdx} names={names} />
      )}
    </div>
  );
}

export function useLiveSamples(deviceId: string): Sample[] {
  const [samples, setSamples] = useState<Sample[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    setSamples([]);

    /* Live view is API websocket only. USB/BLE drain feeds the API; it does not paint the chart. */
    openLiveStream(liveStreamUrl(API_URL, deviceId), abort.signal, (data) => {
      const incoming = normalizeSamples(data).map((s) => ({ ...s, ts: coerceLiveTs(s.ts) }));
      setSamples((prev) => mergeSamples(prev, incoming));
    });

    return () => {
      abort.abort();
    };
  }, [deviceId]);

  return samples;
}
