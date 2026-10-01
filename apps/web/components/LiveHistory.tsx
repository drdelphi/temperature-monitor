'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL, CHANNEL_COUNT, SAMPLE_WARN_COUNT } from '@/lib/config';
import { apiBlob, apiGet, queryString } from '@/lib/api';
import { channelHue } from '@/lib/colors';
import { errorMessage, formatTemp, isoFilenameStamp, toLocalInput } from '@/lib/format';
import { asRecord, type Device, type Sample, normalizeSamples } from '@/lib/types';
import { historyRows, mergeSamples, sparkPoints } from '@/lib/samples';
import { liveStreamUrl, openLiveStream } from '@/lib/ws';
import { HistoryChart, Sparkline } from './charts';
import { Button, ErrorText } from './ui';

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

export function LiveReadings({
  device,
  liveSamples,
}: {
  device: Device;
  liveSamples: Sample[];
}) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Sensor</th>
            <th>Name</th>
            <th>Temperature</th>
            <th>Last 2 minutes</th>
          </tr>
        </thead>
        <tbody>
          {device.channels
            .filter((c) => c.enabled)
            .map((c) => (
              <tr key={c.index}>
                <td>
                  <span className="ch-pip" style={{ background: channelHue(c.index) }} />
                  {c.index}
                </td>
                <td>{c.name}</td>
                <td className="num">{formatTemp(c.lastTempC)}</td>
                <td>
                  <Sparkline points={sparkPoints(liveSamples, c.index)} color={channelHue(c.index)} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {liveSamples.length === 0 &&
      device.channels.filter((c) => c.enabled).every((c) => c.lastTempC == null) ? (
        <p className="hint">Waiting for readings from this monitor…</p>
      ) : null}
    </div>
  );
}

export function HistoryReadings({ device }: { device: Device }) {
  const [range, setRange] = useState(defaultRange);
  const [selected, setSelected] = useState<boolean[]>(() =>
    Array.from({ length: CHANNEL_COUNT }, (_, i) => device.channels[i]?.enabled !== false),
  );
  const [hist, setHist] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const enabledIdx = useMemo(
    () => selected.map((on, i) => (on ? i : -1)).filter((i) => i >= 0),
    [selected],
  );

  const loadHistory = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const from = new Date(range.from).toISOString();
      const to = new Date(range.to).toISOString();
      const q = queryString({
        deviceId: device.id,
        from,
        to,
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
    <>
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
      <div className="row channel-picks">
        {device.channels.map((c) => (
          <label key={c.index} className="check" title={c.name}>
            <input
              type="checkbox"
              checked={selected[c.index] ?? false}
              onChange={() =>
                setSelected((s) => {
                  const n = [...s];
                  n[c.index] = !n[c.index];
                  return n;
                })
              }
            />
            <span className="ch-pip" style={{ background: channelHue(c.index) }} />
            <span className="check-name">{c.name}</span>
          </label>
        ))}
      </div>
      <ErrorText>{err}</ErrorText>
      {warn ? <p className="warn-text">{warn}</p> : null}
      {rows.length === 0 ? (
        <div className="empty">No readings in this time range.</div>
      ) : (
        <HistoryChart rows={rows} channels={enabledIdx} names={names} />
      )}
    </>
  );
}

export function useLiveSamples(deviceId: string): Sample[] {
  const [samples, setSamples] = useState<Sample[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    setSamples([]);

    /* Live view is API websocket only. USB/BLE drain feeds the API; it does not paint the chart. */
    openLiveStream(liveStreamUrl(API_URL, deviceId), abort.signal, (data) => {
      setSamples((prev) => mergeSamples(prev, normalizeSamples(data)));
    });

    return () => {
      abort.abort();
    };
  }, [deviceId]);

  return samples;
}
