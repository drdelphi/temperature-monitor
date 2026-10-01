'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiSend } from '@/lib/api';
import { connectionKinds, errorMessage, formatMac, transportLabel } from '@/lib/format';
import { linkSession, useLinkSession } from '@/lib/link-session';
import { latestByChannel } from '@/lib/samples';
import { adcToC, adcToOhm } from '@/lib/cal';
import {
  type Alarm,
  type Device,
  asArray,
  normalizeAlarms,
  normalizeDevice,
} from '@/lib/types';
import { AlarmPanel } from './AlarmPanel';
import { ChannelTable } from './ChannelTable';
import { HistoryReadings, LiveReadings, useLiveSamples } from './LiveHistory';
import { RtcPanel } from './RtcPanel';
import { WifiPanel } from './WifiPanel';
import { Button, ErrorText, Field } from './ui';

type Pane = 'live' | 'history' | 'settings';

export function DeviceDashboard({ deviceId }: { deviceId: string }) {
  const id = decodeURIComponent(deviceId).toUpperCase();
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pane, setPane] = useState<Pane>('live');
  const [serialOk, setSerialOk] = useState(true);
  const [bleOk, setBleOk] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const link = useLinkSession();
  const live = useLiveSamples(id);

  const load = useCallback(async () => {
    try {
      const d = normalizeDevice(await apiGet(`/v1/devices/${encodeURIComponent(id)}`));
      setDevice(d);
      setName(d.name);
      setErr(null);
      try {
        const raw = await apiGet(`/v1/devices/${encodeURIComponent(id)}/alarms`);
        setAlarms(normalizeAlarms(raw));
      } catch {
        const extra = asArray((d as unknown as { alarms?: unknown }).alarms);
        setAlarms(normalizeAlarms(extra.length ? extra : []));
      }
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    setSerialOk(typeof navigator !== 'undefined' && Boolean(navigator.serial));
    setBleOk(typeof navigator !== 'undefined' && Boolean(navigator.bluetooth));
  }, []);

  async function saveName() {
    const next = name.trim();
    if (!next || !device || next === device.name) return;
    try {
      await apiSend(`/v1/devices/${encodeURIComponent(id)}`, 'PATCH', { name: next });
      await load();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function connect(kind: 'usb' | 'ble') {
    setErr(null);
    try {
      if (kind === 'usb') await linkSession.connectUsb();
      else await linkSession.connectBle();
      const connectedId = linkSession.deviceId();
      if (connectedId && connectedId !== id) {
        router.push(`/devices/${encodeURIComponent(connectedId)}`);
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFoundError') return;
      setErr(errorMessage(e));
    }
  }

  async function remove() {
    setRemoving(true);
    setErr(null);
    try {
      await apiSend(`/v1/devices/${encodeURIComponent(id)}`, 'DELETE');
      router.replace('/');
    } catch (e) {
      setErr(errorMessage(e));
      setRemoving(false);
    }
  }

  if (err && !device) return <ErrorText>{err}</ErrorText>;
  if (!device) return <div className="busy">Loading monitor…</div>;

  const liveCal = live.map((s) => {
    const ch = device.channels.find((c) => c.index === s.channel);
    if (!ch || s.adcRaw == null) return s;
    return {
      ...s,
      tempC: adcToC(s.adcRaw, ch.bValue, ch.gain, ch.offset),
      rOhm: adcToOhm(s.adcRaw) ?? s.rOhm,
    };
  });
  const latest = latestByChannel(liveCal);
  const merged: Device = {
    ...device,
    channels: device.channels.map((ch) => {
      const s = latest.get(ch.index);
      if (!s) return ch;
      return {
        ...ch,
        lastTempC: s.tempC ?? ch.lastTempC,
        lastROhm: s.rOhm ?? ch.lastROhm,
        lastTs: s.ts ?? ch.lastTs,
      };
    }),
  };

  const linkedHere = Boolean(link.open && link.deviceId === device.id);
  const kinds = connectionKinds({
    lastSeen: device.lastSeen,
    linked: linkedHere,
    transport: linkedHere ? link.transport : null,
    wifiInternet: linkedHere ? link.wifiInternet : null,
    wifiState: linkedHere ? link.wifiState : null,
  });
  const connected = kinds.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{device.name}</h1>
          <p className="sub mac">{formatMac(device.id)}</p>
        </div>
        <div className="page-head-status">
          <p className="status-line">
            {linkedHere && !link.error ? (
              <>
                Connected over <strong>{transportLabel(link.transport) || 'cable'}</strong>
                {link.status && link.status !== 'Connected' && link.status !== 'Not connected' ? (
                  <> · {link.status}</>
                ) : null}
              </>
            ) : connected ? (
              <>Connected over the internet</>
            ) : (
              <>Not connected</>
            )}
          </p>
          {linkedHere ? (
            <Button variant="danger" onClick={() => void linkSession.disconnectByUser()}>
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorText>{link.error || err}</ErrorText>
      {connected ? (
        <>
          <div className="pane-tabs" role="tablist" aria-label="Monitor views">
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'live'}
              className={pane === 'live' ? 'active' : undefined}
              onClick={() => setPane('live')}
            >
              Live
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'history'}
              className={pane === 'history' ? 'active' : undefined}
              onClick={() => setPane('history')}
            >
              History
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'settings'}
              className={pane === 'settings' ? 'active' : undefined}
              onClick={() => setPane('settings')}
            >
              Settings
            </button>
          </div>
          {pane === 'live' ? (
            <LiveReadings device={merged} liveSamples={liveCal} />
          ) : pane === 'history' ? (
            <HistoryReadings device={merged} />
          ) : (
            <div className="monitor-settings">
              <section className="section">
                <h2>Name</h2>
                <div className="card card-pad form-card stack">
                  <Field label="Monitor name">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveName();
                      }}
                    />
                  </Field>
                  <div className="row">
                    <Button
                      variant="primary"
                      onClick={() => void saveName()}
                      disabled={!name.trim() || name.trim() === device.name}
                    >
                      Save name
                    </Button>
                  </div>
                </div>
              </section>
              <section className="section">
                <h2>Wi-Fi</h2>
                <p className="hint">
                  Scan and join a network from this monitor. Stay connected over USB or Bluetooth while you set
                  it up.
                </p>
                <WifiPanel deviceId={device.id} />
              </section>
              <RtcPanel device={merged} onChange={load} />
              <ChannelTable device={merged} onChange={load} />
              <AlarmPanel device={merged} alarms={alarms} onChange={load} />
            </div>
          )}
        </>
      ) : (
        <div className="card card-pad form-card stack">
          <p className="hint">
            Connect this monitor over USB or Bluetooth to see readings and settings, or remove it from the
            list.
          </p>
          <ErrorText>{link.error || err}</ErrorText>
          <div className="row">
            <Button variant="primary" disabled={!serialOk} onClick={() => void connect('usb')}>
              Connect USB
            </Button>
            <Button disabled={!bleOk} onClick={() => void connect('ble')}>
              Connect Bluetooth
            </Button>
            {confirmRemove ? (
              <>
                <Button variant="danger" disabled={removing} onClick={() => void remove()}>
                  {removing ? 'Removing…' : 'Remove this monitor'}
                </Button>
                <Button variant="ghost" disabled={removing} onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmRemove(true)}>
                Remove from list
              </Button>
            )}
          </div>
          {!serialOk ? <p className="warn-text">USB and Bluetooth work in Chrome or Edge.</p> : null}
        </div>
      )}
    </>
  );
}
