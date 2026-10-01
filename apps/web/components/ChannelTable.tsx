'use client';

import { useEffect, useState } from 'react';
import { apiSend } from '@/lib/api';
import {
  DEFAULT_CAL,
  isDefaultCal,
  offsetFromReference,
  rawFromReading,
  twoPointCal,
  uncorrectedFromReading,
} from '@/lib/cal';
import { channelHue } from '@/lib/colors';
import { errorMessage, formatOhm, formatTemp } from '@/lib/format';
import { linkSession } from '@/lib/link-session';
import type { Channel, Device } from '@/lib/types';
import { Toggle } from './ui';

type CalPoint = { raw: number; ref: number };

export function ChannelTable({
  device,
  onChange,
}: {
  device: Device;
  onChange: () => Promise<void> | void;
}) {
  const [points, setPoints] = useState<Record<number, CalPoint>>({});
  const [refs, setRefs] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);

  async function patchMany(updates: { index: number; body: Record<string, unknown> }[]) {
    if (updates.length === 0) return;
    setErr(null);
    try {
      for (const u of updates) {
        await apiSend(`/v1/devices/${encodeURIComponent(device.id)}/channels/${u.index}`, 'PATCH', u.body);
      }
      await linkSession.pushConfig(device.id);
      await onChange();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function patch(index: number, body: Record<string, unknown>) {
    await patchMany([{ index, body }]);
  }

  const needsDefault = device.channels.some((ch) => !isDefaultCal(ch));

  return (
    <div className="section">
      <div className="section-head">
        <h2>Sensors</h2>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!needsDefault}
          onClick={() =>
            void patchMany(
              device.channels
                .filter((ch) => !isDefaultCal(ch))
                .map((ch) => ({ index: ch.index, body: { ...DEFAULT_CAL } })),
            )
          }
        >
          Default for all
        </button>
      </div>
      <p className="hint">
        Sensors start with a standard probe setting. Match a trusted thermometer if a reading looks off.
      </p>
      {err ? <div className="err">{err}</div> : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th />
              <th>On</th>
              <th>Name</th>
              <th>Every (seconds)</th>
              <th>Temperature</th>
              <th>Resistance</th>
              <th>Adjustment</th>
              <th>Reference °C</th>
              <th>Calibrate</th>
            </tr>
          </thead>
          <tbody>
            {device.channels.map((ch) => (
              <ChannelRow
                key={ch.index}
                ch={ch}
                refText={refs[ch.index] ?? ''}
                stored={points[ch.index]}
                onRef={(v) => setRefs((s) => ({ ...s, [ch.index]: v }))}
                onPatch={(body) => void patch(ch.index, body)}
                onStorePoint={(p) => setPoints((s) => ({ ...s, [ch.index]: p }))}
                onError={setErr}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChannelRow({
  ch,
  refText,
  stored,
  onRef,
  onPatch,
  onStorePoint,
  onError,
}: {
  ch: Channel;
  refText: string;
  stored?: CalPoint;
  onRef: (v: string) => void;
  onPatch: (body: Record<string, unknown>) => void;
  onStorePoint: (p: CalPoint) => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(ch.name);
  const [interval, setInterval] = useState(String(ch.intervalSec));

  useEffect(() => {
    setName(ch.name);
    setInterval(String(ch.intervalSec));
  }, [ch.name, ch.intervalSec]);

  function applyOffset() {
    if (ch.lastTempC == null) return;
    const refC = Number(refText);
    if (!Number.isFinite(refC)) return;
    const uncorrected = uncorrectedFromReading(ch.lastTempC, ch.offset);
    onPatch({ offset: offsetFromReference(refC, uncorrected) });
  }

  function storePoint() {
    if (ch.lastTempC == null) return;
    const refC = Number(refText);
    if (!Number.isFinite(refC)) return;
    const raw = rawFromReading(ch.lastTempC, ch.gain, ch.offset);
    onStorePoint({ raw, ref: refC });
  }

  function applyTwoPoint() {
    if (!stored || ch.lastTempC == null) return;
    const refC = Number(refText);
    if (!Number.isFinite(refC)) return;
    const raw = rawFromReading(ch.lastTempC, ch.gain, ch.offset);
    try {
      const { gain, offset } = twoPointCal(stored.raw, stored.ref, raw, refC);
      onPatch({ gain, offset });
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <tr>
      <td>
        <span className="ch-pip" style={{ background: channelHue(ch.index) }} />
        {ch.index}
      </td>
      <td>
        <Toggle on={ch.enabled} onClick={() => onPatch({ enabled: !ch.enabled })} />
      </td>
      <td>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== ch.name) onPatch({ name: name.trim() });
          }}
        />
      </td>
      <td className="narrow">
        <input
          type="number"
          min={1}
          step={1}
          className="narrow"
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
          onBlur={() => {
            const n = Math.max(1, Math.floor(Number(interval)));
            if (Number.isFinite(n) && n !== ch.intervalSec) onPatch({ intervalSec: n });
            else setInterval(String(ch.intervalSec));
          }}
        />
      </td>
      <td className="num">{formatTemp(ch.lastTempC)}</td>
      <td className="num">{formatOhm(ch.lastROhm)}</td>
      <td className="num">
        {isDefaultCal(ch) ? (
          <span className="hint">Default</span>
        ) : (
          <>
            {ch.offset.toFixed(3)} / {ch.gain.toFixed(4)}
          </>
        )}
        {stored ? (
          <div className="hint">
            Saved point {stored.ref.toFixed(2)} °C
          </div>
        ) : null}
      </td>
      <td className="narrow">
        <input
          type="number"
          step="0.01"
          className="narrow"
          value={refText}
          onChange={(e) => onRef(e.target.value)}
          placeholder="°C"
        />
      </td>
      <td>
        <div className="row">
          <button type="button" className="btn" onClick={applyOffset} disabled={ch.lastTempC == null}>
            Match
          </button>
          <button type="button" className="btn btn-ghost" onClick={storePoint} disabled={ch.lastTempC == null}>
            Save point
          </button>
          <button type="button" className="btn btn-ghost" onClick={applyTwoPoint} disabled={!stored || ch.lastTempC == null}>
            Finish
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={isDefaultCal(ch)}
            onClick={() => onPatch({ ...DEFAULT_CAL })}
          >
            Default
          </button>
        </div>
      </td>
    </tr>
  );
}
