'use client';

import { useEffect, useState } from 'react';
import { CHANNEL_COUNT } from '@/lib/config';
import { apiSend } from '@/lib/api';
import { channelHue } from '@/lib/colors';
import { errorMessage, alarmKindLabel } from '@/lib/format';
import type { Alarm, AlarmKind, Device } from '@/lib/types';
import { Button, ErrorText, Toggle } from './ui';

type Draft = {
  enabled: boolean;
  thresholdC: string;
  hysteresis: string;
  cooldownSec: string;
  notifyTelegram: boolean;
  notifySms: boolean;
};

function emptyDraft(): Draft {
  return {
    enabled: false,
    thresholdC: '',
    hysteresis: '0.5',
    cooldownSec: '300',
    notifyTelegram: false,
    notifySms: false,
  };
}

function fromAlarm(a?: Alarm): Draft {
  if (!a) return emptyDraft();
  return {
    enabled: a.enabled,
    thresholdC: String(a.thresholdC),
    hysteresis: String(a.hysteresis),
    cooldownSec: String(a.cooldownSec),
    notifyTelegram: a.notifyTelegram,
    notifySms: a.notifySms,
  };
}

function findAlarm(alarms: Alarm[], channel: number, kind: AlarmKind): Alarm | undefined {
  return alarms.find((a) => a.channel === channel && a.kind === kind);
}

export function AlarmPanel({
  device,
  alarms,
  onChange,
}: {
  device: Device;
  alarms: Alarm[];
  onChange: () => Promise<void> | void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next: Record<string, Draft> = {};
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      next[`${i}-below`] = fromAlarm(findAlarm(alarms, i, 'below'));
      next[`${i}-above`] = fromAlarm(findAlarm(alarms, i, 'above'));
    }
    setDrafts(next);
  }, [alarms]);

  function key(ch: number, kind: AlarmKind) {
    return `${ch}-${kind}`;
  }

  function set(ch: number, kind: AlarmKind, patch: Partial<Draft>) {
    const k = key(ch, kind);
    setDrafts((d) => ({ ...d, [k]: { ...(d[k] ?? emptyDraft()), ...patch } }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Alarm[] = [];
      for (let i = 0; i < CHANNEL_COUNT; i++) {
        for (const kind of ['below', 'above'] as AlarmKind[]) {
          const d = drafts[key(i, kind)] ?? emptyDraft();
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
        <table className="data">
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
            {device.channels.map((ch) =>
              (['below', 'above'] as AlarmKind[]).map((kind) => {
                const d = drafts[key(ch.index, kind)] ?? emptyDraft();
                return (
                  <tr key={key(ch.index, kind)}>
                    <td>
                      <span className="ch-pip" style={{ background: channelHue(ch.index) }} />
                      {ch.name}
                    </td>
                    <td>
                      <span className={kind === 'below' ? 'alarm-cold' : 'alarm-hot'}>
                        {alarmKindLabel(kind)}
                      </span>
                    </td>
                    <td>
                      <Toggle on={d.enabled} onClick={() => set(ch.index, kind, { enabled: !d.enabled })} />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        className="narrow"
                        value={d.thresholdC}
                        onChange={(e) => set(ch.index, kind, { thresholdC: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        className="narrow"
                        value={d.hysteresis}
                        onChange={(e) => set(ch.index, kind, { hysteresis: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="narrow"
                        value={d.cooldownSec}
                        onChange={(e) => set(ch.index, kind, { cooldownSec: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={d.notifyTelegram}
                        onChange={(e) => set(ch.index, kind, { notifyTelegram: e.target.checked })}
                      />
                    </td>
                    <td>
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
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          Save alerts
        </Button>
      </div>
    </div>
  );
}
