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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = isSensorsDirty(drafts, saved);

  useEffect(() => {
    const next = draftsFromChannels(device.channels);
    setDrafts(next);
    setSaved(next);
    setPoints({});
    setRefs({});
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
              Object.fromEntries(Object.entries(d).map(([k, v]) => [Number(k), { ...v, ...DEFAULT_CAL }])),
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
                  onRef={(v) => setRefs((s) => ({ ...s, [ch.index]: v }))}
                  onDraft={(patch) => updateDraft(ch.index, patch)}
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
  onRef,
  onDraft,
  onStorePoint,
  onError,
}: {
  ch: Channel;
  draft: ChannelDraft;
  refText: string;
  stored?: CalPoint;
  onRef: (v: string) => void;
  onDraft: (patch: Partial<ChannelDraft>) => void;
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

  return (
    <tr>
      <td>
        <span className="ch-pip" style={{ background: channelHue(ch.index) }} />
        {ch.index}
      </td>
      <td>
        <Toggle on={draft.enabled} onClick={() => onDraft({ enabled: !draft.enabled })} />
      </td>
      <td>
        <input type="text" value={draft.name} onChange={(e) => onDraft({ name: e.target.value })} />
      </td>
      <td className="narrow">
        <input
          type="number"
          min={1}
          step={1}
          className="narrow"
          value={draft.intervalSec}
          onChange={(e) => onDraft({ intervalSec: e.target.value })}
        />
      </td>
      <td className="num">{formatTemp(ch.lastTempC)}</td>
      <td className="num">{formatOhm(ch.lastROhm)}</td>
      <td className="num">
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
            disabled={isDefaultCal(draft)}
            onClick={() => onDraft({ ...DEFAULT_CAL })}
          >
            Default
          </button>
        </div>
      </td>
    </tr>
  );
}
