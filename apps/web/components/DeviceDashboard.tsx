'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiSend } from '@/lib/api';
import {
  connectionKindsFromLink,
  errorMessage,
  formatMac,
  formatRtcDateTime,
  liveRtcUnix,
  maxTs,
  transportLabel,
  unixFromIso,
} from '@/lib/format';
import { linkSession, useLinkSession } from '@/lib/link-session';
import { latestByChannel } from '@/lib/samples';
import { adcToC, adcToOhm } from '@/lib/cal';
import { requestLeave, setLeaveGuard } from '@/lib/leave-guard';
import { useVisiblePolling } from '@/lib/poll';
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
import { Button, ConfirmDialog, ErrorText, Field } from './ui';

type Pane = 'live' | 'history' | 'settings';

const RTC_POLL_MS = 50_000;

function discardCopy(sensorsDirty: boolean, alertsDirty: boolean): { title: string; body: string } {
  if (sensorsDirty && alertsDirty) {
    return {
      title: 'Discard unsaved changes?',
      body: 'You have unsaved sensor and alert changes. Leave without saving?',
    };
  }
  if (alertsDirty) {
    return {
      title: 'Discard alert changes?',
      body: 'You have unsaved alert changes. Leave without saving?',
    };
  }
  return {
    title: 'Discard sensor changes?',
    body: 'You have unsaved sensor changes. Leave without saving?',
  };
}

function DeviceRtcClock({
  rtcUnix,
  rtcReceivedAt,
}: {
  rtcUnix: number | null;
  rtcReceivedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const unix = liveRtcUnix(rtcUnix, rtcReceivedAt, now);
  if (unix == null) return null;
  return (
    <time className="pane-clock" dateTime={new Date(unix * 1000).toISOString()}>
      {formatRtcDateTime(unix)}
    </time>
  );
}

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
  const [removeOpen, setRemoveOpen] = useState(false);
  const [sensorsDirty, setSensorsDirty] = useState(false);
  const [alertsDirty, setAlertsDirty] = useState(false);
  const settingsDirty = sensorsDirty || alertsDirty;
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingLeave = useRef<(() => void) | null>(null);
  const link = useLinkSession();
  const live = useLiveSamples(id);
  const liveRef = useRef(live);
  liveRef.current = live;
  const [sampleRtc, setSampleRtc] = useState<{ unix: number; at: number } | null>(null);

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

  useVisiblePolling(load, 8000);

  useEffect(() => {
    setSerialOk(typeof navigator !== 'undefined' && Boolean(navigator.serial));
    setBleOk(typeof navigator !== 'undefined' && Boolean(navigator.bluetooth));
  }, []);

  useEffect(() => {
    setSampleRtc(null);
  }, [id]);

  useEffect(() => {
    if (pane !== 'live') return;
    const linked = Boolean(link.open && link.deviceId === id);
    if (linked) {
      const pull = () => {
        void linkSession.refreshStatus().catch(() => undefined);
      };
      pull();
      const t = window.setInterval(pull, RTC_POLL_MS);
      return () => window.clearInterval(t);
    }
    const take = () => {
      const unix = unixFromIso(maxTs(liveRef.current));
      if (unix != null) setSampleRtc({ unix, at: Date.now() });
    };
    take();
    const t = window.setInterval(take, RTC_POLL_MS);
    return () => window.clearInterval(t);
  }, [pane, link.open, link.deviceId, id]);

  useEffect(() => {
    if (pane !== 'live' || (link.open && link.deviceId === id) || sampleRtc) return;
    const unix = unixFromIso(maxTs(live));
    if (unix != null) setSampleRtc({ unix, at: Date.now() });
  }, [live, pane, link.open, link.deviceId, id, sampleRtc]);

  useEffect(() => {
    if (!settingsDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [settingsDirty]);

  useEffect(() => {
    if (!settingsDirty) {
      setLeaveGuard(null);
      return;
    }
    setLeaveGuard((proceed) => {
      pendingLeave.current = proceed;
      setDiscardOpen(true);
      return false;
    });
    return () => setLeaveGuard(null);
  }, [settingsDirty]);

  useEffect(() => {
    if (!settingsDirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const a = target.closest('a');
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute('download')) return;
      if (a.target && a.target !== '_self') return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      requestLeave(() => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [settingsDirty, router]);

  function requestPane(next: Pane) {
    if (next === pane) return;
    requestLeave(() => setPane(next));
  }

  function confirmDiscard() {
    const go = pendingLeave.current;
    pendingLeave.current = null;
    setDiscardOpen(false);
    go?.();
  }

  function cancelDiscard() {
    pendingLeave.current = null;
    setDiscardOpen(false);
  }

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
  const rtcUnix = linkedHere ? link.rtcUnix : sampleRtc?.unix ?? null;
  const rtcReceivedAt = linkedHere ? link.rtcReceivedAt : sampleRtc?.at ?? null;
  const kinds = connectionKindsFromLink(device, link);
  const connected = kinds.length > 0;
  const wifiLive = kinds.includes('wifi');
  const leaveDialog = discardCopy(sensorsDirty, alertsDirty);

  return (
    <div className="device-page">
      <div className="page-head">
        <div>
          <h1>{device.name}</h1>
          <p className="sub mac">{formatMac(device.id)}</p>
        </div>
        <div className="page-head-status">
          <p className="status-line">
            {wifiLive ? (
              <>Connected over the internet</>
            ) : linkedHere && !link.error ? (
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
        <div className="device-pane">
          <div className="pane-tabs-row">
            <div className="pane-tabs" role="tablist" aria-label="Monitor views">
              <button
                type="button"
                role="tab"
                aria-selected={pane === 'live'}
                className={pane === 'live' ? 'active' : undefined}
                onClick={() => requestPane('live')}
              >
                Live
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pane === 'history'}
                className={pane === 'history' ? 'active' : undefined}
                onClick={() => requestPane('history')}
              >
                History
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pane === 'settings'}
                className={pane === 'settings' ? 'active' : undefined}
                onClick={() => requestPane('settings')}
              >
                Settings
              </button>
            </div>
            {pane === 'live' ? <DeviceRtcClock rtcUnix={rtcUnix} rtcReceivedAt={rtcReceivedAt} /> : null}
          </div>
          {pane === 'live' ? (
            <LiveReadings key={device.id} device={merged} liveSamples={liveCal} />
          ) : pane === 'history' ? (
            <HistoryReadings device={merged} />
          ) : (
            <div className="monitor-settings">
              <div className="settings-name-clock">
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
                <RtcPanel device={merged} onChange={load} />
              </div>
              <section className="section">
                <h2>Wi-Fi</h2>
                <p className="hint">
                  Scan and join a network from this monitor. Stay connected over USB or Bluetooth while you set
                  it up.
                </p>
                <WifiPanel deviceId={device.id} />
              </section>
              <ChannelTable device={merged} onChange={load} onDirtyChange={setSensorsDirty} />
              <AlarmPanel device={merged} alarms={alarms} onChange={load} onDirtyChange={setAlertsDirty} />
            </div>
          )}
        </div>
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
            <Button variant="danger" onClick={() => setRemoveOpen(true)}>
              Remove from list
            </Button>
          </div>
          {!serialOk ? (
            <p className="warn-text">
              {bleOk
                ? 'USB needs Chrome or Edge on a computer. From a phone, connect over Bluetooth.'
                : 'USB and Bluetooth need Chrome or Edge on a computer.'}
            </p>
          ) : null}
        </div>
      )}
      {removeOpen ? (
        <ConfirmDialog
          title="Remove this monitor?"
          confirmLabel={removing ? 'Removing…' : 'Remove'}
          busy={removing}
          onConfirm={() => void remove()}
          onCancel={() => setRemoveOpen(false)}
        >
          <p>
            Remove {device.name} from the list? You can add it again later over USB or Bluetooth.
          </p>
        </ConfirmDialog>
      ) : null}
      {discardOpen ? (
        <ConfirmDialog
          title={leaveDialog.title}
          confirmLabel="Discard"
          onConfirm={confirmDiscard}
          onCancel={cancelDiscard}
        >
          <p>{leaveDialog.body}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
