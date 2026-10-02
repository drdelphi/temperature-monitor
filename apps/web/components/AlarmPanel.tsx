'use client';

import { useEffect, useState } from 'react';
import { apiSend } from '@/lib/api';
import {
  type AlarmDraft,
  alarmKey,
  draftsFromAlarms,
  emptyAlarmDraft,
  isAlarmsDirty,
} from '@/lib/alarm-drafts';
import { CHANNEL_COUNT } from '@/lib/config';
import { channelHue } from '@/lib/colors';
import { errorMessage, alarmKindLabel } from '@/lib/format';
import type { Alarm, AlarmKind, Device } from '@/lib/types';
import { Button, ErrorText, Toggle } from './ui';

export function AlarmPanel({
  device,
  alarms,
  onChange,
  onDirtyChange,
}: {
  device: Device;
  alarms: Alarm[];
  onChange: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState(() => draftsFromAlarms(alarms));
  const [saved, setSaved] = useState(() => draftsFromAlarms(alarms));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = isAlarmsDirty(drafts, saved);

  useEffect(() => {
    const next = draftsFromAlarms(alarms);
    setDrafts(next);
    setSaved(next);
    setErr(null);
  }, [device.id]);

  useEffect(() => {
    if (dirty || busy) return;
    const server = draftsFromAlarms(alarms);
    if (!isAlarmsDirty(server, saved)) return;
    setDrafts(server);
    setSaved(server);
  }, [alarms, dirty, saved, busy]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  function set(ch: number, kind: AlarmKind, patch: Partial<AlarmDraft>) {
    const k = alarmKey(ch, kind);
    setDrafts((d) => ({ ...d, [k]: { ...(d[k] ?? emptyAlarmDraft()), ...patch } }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Alarm[] = [];
      for (let i = 0; i < CHANNEL_COUNT; i++) {
        for (const kind of ['below', 'above'] as AlarmKind[]) {
          const d = drafts[alarmKey(i, kind)] ?? emptyAlarmDraft();
          body.push({
            channel: i,
            kind,
            enabled: d.enabled,
            thresholdC: Number(d.thresholdC) || 0,
            hysteresis: Number(d.hysteresis) || 0,
            cooldownSec: Math.max(0, Math.floor(Number(d.cooldownSec) || 0)),
            notifyTelegram: d.notifyTelegram,
            notifySms: d.notifySms,
          });
        }
      }
      await apiSend(`/v1/devices/${encodeURIComponent(device.id)}/alarms`, 'PUT', body);
      setSaved(drafts);
      await onChange();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <h2>Alerts</h2>
      <p className="hint">
        Set a too-cold and too-hot limit for each sensor. Wait time is how long to pause after an alert.
      </p>
      <ErrorText>{err}</ErrorText>
      <div className="table-wrap mt">
        <table className="data alerts-table">
          <thead>
            <tr>
              <th>Sensor</th>
              <th>When</th>
              <th>On</th>
              <th>Limit °C</th>
              <th>Reset gap °C</th>
              <th>Wait (seconds)</th>
              <th>Telegram</th>
              <th>SMS</th>
            </tr>
          </thead>
          <tbody>
            {device.channels
              .filter((ch) => ch.enabled)
              .map((ch) =>
                (['below', 'above'] as AlarmKind[]).map((kind) => {
                const d = drafts[alarmKey(ch.index, kind)] ?? emptyAlarmDraft();
                return (
                  <tr key={alarmKey(ch.index, kind)}>
                    {/* data-label feeds the one-card-per-row layout phones get; see globals.css. */}
                    <td data-label="Sensor" className="cell-wide cell-sensor-name">
                      <span className="ch-pip" style={{ background: channelHue(ch.index) }} />
                      {ch.name}
                    </td>
                    <td data-label="When" className="cell-when">
                      <span className={kind === 'below' ? 'alarm-cold' : 'alarm-hot'}>
                        {alarmKindLabel(kind)}
                      </span>
                    </td>
                    <td data-label="On" className="cell-on">
                      <Toggle
                        on={d.enabled}
                        onClick={() => set(ch.index, kind, { enabled: !d.enabled })}
                        title="Alert on"
                      />
                    </td>
                    <td data-label="Limit °C" className="cell-limit">
                      <input
                        type="number"
                        step="0.1"
                        className="narrow"
                        value={d.thresholdC}
                        onChange={(e) => set(ch.index, kind, { thresholdC: e.target.value })}
                      />
                    </td>
                    <td data-label="Reset gap °C" className="cell-hysteresis">
                      <input
                        type="number"
                        step="0.1"
                        className="narrow"
                        value={d.hysteresis}
                        onChange={(e) => set(ch.index, kind, { hysteresis: e.target.value })}
                      />
                    </td>
                    <td data-label="Wait (seconds)" className="cell-wide cell-wait">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="narrow"
                        value={d.cooldownSec}
                        onChange={(e) => set(ch.index, kind, { cooldownSec: e.target.value })}
                      />
                    </td>
                    <td data-label="Telegram" className="cell-notify">
                      <input
                        type="checkbox"
                        checked={d.notifyTelegram}
                        onChange={(e) => set(ch.index, kind, { notifyTelegram: e.target.checked })}
                      />
                    </td>
                    <td data-label="SMS" className="cell-notify">
                      <input
                        type="checkbox"
                        checked={d.notifySms}
                        onChange={(e) => set(ch.index, kind, { notifySms: e.target.checked })}
                      />
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <div className="row mt">
        <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save alerts'}
        </Button>
      </div>
    </div>
  );
}
