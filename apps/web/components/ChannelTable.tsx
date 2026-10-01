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
import {
  B_VALUE_MAX,
  B_VALUE_MIN,
  CUSTOM_CURVE_ID,
  NTC_CURVES,
  bValueForCurveId,
  curveIdForBValue,
} from '@/lib/curves';
import { channelHue } from '@/lib/colors';
import { errorMessage, formatOhm, formatTemp } from '@/lib/format';
import { linkSession } from '@/lib/link-session';
import {
  type ChannelDraft,
  channelPatchBody,
  draftsFromChannels,
  isSensorsDirty,
  normalizeDraft,
  validateDrafts,
} from '@/lib/sensor-drafts';
import type { Channel, Device } from '@/lib/types';
import { Button, Toggle } from './ui';

type CalPoint = { raw: number; ref: number };

export function ChannelTable({
  device,
  onChange,
  onDirtyChange,
}: {
  device: Device;
  onChange: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState(() => draftsFromChannels(device.channels));
  const [saved, setSaved] = useState(() => draftsFromChannels(device.channels));
  const [points, setPoints] = useState<Record<number, CalPoint>>({});
  const [refs, setRefs] = useState<Record<number, string>>({});
  const [customCurve, setCustomCurve] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = isSensorsDirty(drafts, saved);

  useEffect(() => {
    const next = draftsFromChannels(device.channels);
    setDrafts(next);
    setSaved(next);
    setPoints({});
    setRefs({});
    setCustomCurve({});
    setErr(null);
  }, [device.id]);

  useEffect(() => {
    if (dirty || busy) return;
    const server = draftsFromChannels(device.channels);
    if (!isSensorsDirty(server, saved)) return;
    setDrafts(server);
    setSaved(server);
  }, [device.channels, dirty, saved, busy]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  function updateDraft(index: number, patch: Partial<ChannelDraft>) {
    setDrafts((d) => ({ ...d, [index]: { ...d[index], ...patch } }));
  }

  async function save() {
    const invalid = validateDrafts(drafts);
    if (invalid) {
      setErr(invalid);
      return;
    }
    const updates = device.channels.flatMap((ch) => {
      const draft = drafts[ch.index];
      const keep = saved[ch.index];
      if (!draft || !keep) return [];
      const body = channelPatchBody(draft, keep);
      return body ? [{ index: ch.index, body }] : [];
    });
    const next = Object.fromEntries(
      Object.entries(drafts).map(([k, d]) => [Number(k), normalizeDraft(d)]),
    );
    setBusy(true);
    setErr(null);
    try {
      for (const u of updates) {
        await apiSend(`/v1/devices/${encodeURIComponent(device.id)}/channels/${u.index}`, 'PATCH', u.body);
      }
      if (updates.length) await linkSession.pushConfig(device.id);
      setDrafts(next);
      setSaved(next);
      setCustomCurve({});
      await onChange();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const needsDefault = Object.values(drafts).some((d) => !isDefaultCal(d));

  return (
    <div className="section">
      <div className="section-head">
        <h2>Sensors</h2>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!needsDefault}
          onClick={() =>
            setDrafts((d) =>
              Object.fromEntries(
                Object.entries(d).map(([k, v]) => [
                  Number(k),
                  { ...v, offset: DEFAULT_CAL.offset, gain: DEFAULT_CAL.gain },
                ]),
              ),
            )
          }
        >
          Default calibration for all
        </button>
      </div>
      <p className="hint">
        Sensors start as a typical 10 kΩ Type II (B3950) probe. Choose the curve that matches the sensor, then
        match a trusted thermometer if a reading looks off.
      </p>
      {err ? <div className="err">{err}</div> : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th />
              <th>On</th>
              <th>Name</th>
              <th>Curve</th>
              <th>Every (seconds)</th>
              <th>Temperature</th>
              <th>Resistance</th>
              <th>Adjustment</th>
              <th>Reference °C</th>
              <th>Calibrate</th>
            </tr>
          </thead>
          <tbody>
            {device.channels.map((ch) => {
              const draft = drafts[ch.index] ?? saved[ch.index];
              if (!draft) return null;
              return (
                <ChannelRow
                  key={ch.index}
                  ch={ch}
                  draft={draft}
                  refText={refs[ch.index] ?? ''}
                  stored={points[ch.index]}
                  customCurve={Boolean(customCurve[ch.index])}
                  onRef={(v) => setRefs((s) => ({ ...s, [ch.index]: v }))}
                  onDraft={(patch) => updateDraft(ch.index, patch)}
                  onCustomCurve={(on) => setCustomCurve((s) => ({ ...s, [ch.index]: on }))}
                  onStorePoint={(p) => setPoints((s) => ({ ...s, [ch.index]: p }))}
                  onError={setErr}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row mt">
        <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save sensors'}
        </Button>
      </div>
    </div>
  );
}

function ChannelRow({
  ch,
  draft,
  refText,
  stored,
  customCurve,
  onRef,
  onDraft,
  onCustomCurve,
  onStorePoint,
  onError,
}: {
  ch: Channel;
  draft: ChannelDraft;
  refText: string;
  stored?: CalPoint;
  customCurve: boolean;
  onRef: (v: string) => void;
  onDraft: (patch: Partial<ChannelDraft>) => void;
  onCustomCurve: (on: boolean) => void;
  onStorePoint: (p: CalPoint) => void;
  onError: (msg: string | null) => void;
}) {
  function applyOffset() {
    if (ch.lastTempC == null) return;
    const refC = Number(refText);
    if (!Number.isFinite(refC)) return;
    const uncorrected = uncorrectedFromReading(ch.lastTempC, draft.offset);
    onDraft({ offset: offsetFromReference(refC, uncorrected) });
  }

  function storePoint() {
    if (ch.lastTempC == null) return;
    const refC = Number(refText);
    if (!Number.isFinite(refC)) return;
    const raw = rawFromReading(ch.lastTempC, draft.gain, draft.offset);
    onStorePoint({ raw, ref: refC });
  }

  function applyTwoPoint() {
    if (!stored || ch.lastTempC == null) return;
    const refC = Number(refText);
    if (!Number.isFinite(refC)) return;
    const raw = rawFromReading(ch.lastTempC, draft.gain, draft.offset);
    try {
      const { gain, offset } = twoPointCal(stored.raw, stored.ref, raw, refC);
      onDraft({ gain, offset });
      onError(null);
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  const active = draft.enabled;
  const canCalibrate = active && ch.lastTempC != null;
  const curveId = curveIdForBValue(draft.bValue, customCurve);

  function onCurveChange(id: string) {
    if (id === CUSTOM_CURVE_ID) {
      onCustomCurve(true);
      return;
    }
    const bValue = bValueForCurveId(id);
    if (bValue == null) return;
    onCustomCurve(false);
    onDraft({ bValue });
  }

  return (
    <tr>
      {/* data-label feeds the one-card-per-row layout phones get; see globals.css. */}
      <td data-label="Sensor">
        <span className="ch-pip" style={{ background: channelHue(ch.index) }} />
        {ch.index}
      </td>
      <td data-label="On">
        <Toggle on={draft.enabled} onClick={() => onDraft({ enabled: !draft.enabled })} />
      </td>
      <td data-label="Name" className="cell-wide">
        <input type="text" value={draft.name} onChange={(e) => onDraft({ name: e.target.value })} />
      </td>
      <td data-label="Curve" className="cell-wide">
        <div className="curve-cell">
          <select value={curveId} onChange={(e) => onCurveChange(e.target.value)}>
            {NTC_CURVES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value={CUSTOM_CURVE_ID}>Custom B</option>
          </select>
          {curveId === CUSTOM_CURVE_ID ? (
            <input
              type="number"
              min={B_VALUE_MIN}
              max={B_VALUE_MAX}
              step={1}
              className="narrow"
              value={Number.isFinite(draft.bValue) ? draft.bValue : ''}
              onChange={(e) => onDraft({ bValue: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
              placeholder="B"
            />
          ) : null}
        </div>
      </td>
      <td data-label="Every (seconds)" className="narrow">
        <input
          type="number"
          min={1}
          step={1}
          className="narrow"
          value={draft.intervalSec}
          onChange={(e) => onDraft({ intervalSec: e.target.value })}
        />
      </td>
      <td data-label="Temperature" className="num">{active ? formatTemp(ch.lastTempC) : null}</td>
      <td data-label="Resistance" className="num">{active ? formatOhm(ch.lastROhm) : null}</td>
      <td data-label="Adjustment" className="num">
        {isDefaultCal(draft) ? (
          <span className="hint">Default</span>
        ) : (
          <>
            {draft.offset.toFixed(3)} / {draft.gain.toFixed(4)}
          </>
        )}
        {stored ? (
          <div className="hint">
            Saved point {stored.ref.toFixed(2)} °C
          </div>
        ) : null}
      </td>
      <td data-label="Reference °C" className="narrow">
        <input
          type="number"
          step="0.01"
          className="narrow"
          value={refText}
          onChange={(e) => onRef(e.target.value)}
          placeholder="°C"
          disabled={!active}
        />
      </td>
      <td data-label="Calibrate" className="cell-wide">
        <div className="row">
          <button type="button" className="btn" onClick={applyOffset} disabled={!canCalibrate}>
            Match
          </button>
          <button type="button" className="btn btn-ghost" onClick={storePoint} disabled={!canCalibrate}>
            Save point
          </button>
          <button type="button" className="btn btn-ghost" onClick={applyTwoPoint} disabled={!canCalibrate || !stored}>
            Finish
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!active || isDefaultCal(draft)}
            onClick={() => onDraft({ offset: DEFAULT_CAL.offset, gain: DEFAULT_CAL.gain })}
          >
            Default
          </button>
        </div>
      </td>
    </tr>
  );
}
