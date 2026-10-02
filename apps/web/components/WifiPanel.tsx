'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage, formatMac, transportLabel, wifiAuthLabel, wifiSignalLabel, wifiStateLabel } from '@/lib/format';
import { linkSession, useLinkSession } from '@/lib/link-session';
import { type WifiNetwork, wifiAuthNeedsPassword } from '@/lib/types';
import { Button, ErrorText, Field } from './ui';

/** Covers the firmware join timeout (15s) plus a little slack. */
const JOIN_WAIT_TRIES = 20;

async function connectUsb() {
  await linkSession.connectUsb();
}

async function connectBle() {
  await linkSession.connectBle();
}

function dash(v: string | number | boolean | null | undefined): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

export function WifiPanel({ deviceId }: { deviceId?: string }) {
  const link = useLinkSession();
  const expected = deviceId?.toUpperCase();
  const matches = !expected || (link.open && link.deviceId === expected);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [pick, setPick] = useState('');
  const [manual, setManual] = useState(false);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'scan' | 'save' | 'forget' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [serialOk, setSerialOk] = useState(true);
  const [bleOk, setBleOk] = useState(true);

  const selected = networks.find((n) => n.ssid === ssid);
  const needsPass = manual || wifiAuthNeedsPassword(selected?.auth);

  const refresh = useCallback(async () => {
    if (!linkSession.isOpen()) return;
    try {
      await linkSession.refreshStatus();
    } catch {
      /* status is best-effort */
    }
  }, []);

  useEffect(() => {
    setSerialOk(typeof navigator !== 'undefined' && Boolean(navigator.serial));
    setBleOk(typeof navigator !== 'undefined' && Boolean(navigator.bluetooth));
  }, []);

  useEffect(() => {
    if (!link.open) return;
    void refresh();
  }, [link.open, link.deviceId, refresh]);

  useEffect(() => {
    if (link.wifiSsid && !ssid) setSsid(link.wifiSsid);
  }, [link.wifiSsid, ssid]);

  const scan = useCallback(async () => {
    setBusy('scan');
    setErr(null);
    setNote(null);
    try {
      const list = await linkSession.scanWifi();
      setNetworks(list);
      const current = linkSession.getState().wifiSsid;
      if (!list.length) {
        setManual(true);
        setNote('No networks found. You can type the network name instead.');
      } else {
        setManual(false);
        if (current && list.some((n) => n.ssid === current)) {
          setSsid(current);
          setPick(current);
        }
      }
    } catch (e) {
      setErr(errorMessage(e));
      setManual(true);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!link.open) return;
    void scan();
  }, [link.open, link.deviceId, scan]);

  async function save() {
    const name = ssid.trim();
    if (!name) {
      setErr('Choose a network, or type its name.');
      return;
    }
    setBusy('save');
    setErr(null);
    setNote(null);
    try {
      await linkSession.setWifi(name, needsPass ? password : '');
      setNote(`Connecting to ${name}…`);
      let joined = false;
      for (let i = 0; i < JOIN_WAIT_TRIES; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        await linkSession.refreshStatus();
        const st = linkSession.getState();
        if (st.wifiIp && st.wifiSsid === name) {
          joined = true;
          break;
        }
      }
      if (joined) {
        setNote(`Connected to ${name}`);
      } else {
        setNote(null);
        setErr(`Could not join ${name}. Check the password, and that the network is in range.`);
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function forget() {
    setBusy('forget');
    setErr(null);
    setNote(null);
    try {
      await linkSession.setWifi('', '');
      setPassword('');
      setSsid('');
      setPick('');
      setManual(false);
      await linkSession.refreshStatus();
      if (linkSession.getState().wifiSsid) {
        setErr('The monitor still reports a saved network. Try again.');
      } else {
        setNote('Saved Wi-Fi network removed. Pick another network to join it.');
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onConnect(kind: 'usb' | 'ble') {
    setErr(null);
    try {
      if (kind === 'usb') await connectUsb();
      else await connectBle();
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFoundError') return;
      setErr(errorMessage(e));
    }
  }

  if (!link.open || !matches) {
    return (
      <div className="card card-pad">
        <p className="hint">
          {link.open && expected && link.deviceId !== expected
            ? 'A different monitor is connected on this computer. Disconnect it, then connect this one over USB or Bluetooth.'
            : 'Connect this monitor over USB or Bluetooth, then scan and join a Wi-Fi network.'}
        </p>
        <div className="row mt">
          <Button variant="primary" disabled={!serialOk} onClick={() => void onConnect('usb')}>
            Connect USB
          </Button>
          <Button disabled={!bleOk} onClick={() => void onConnect('ble')}>
            Connect Bluetooth
          </Button>
        </div>
        <div className="mt">
          <ErrorText>{link.error || err}</ErrorText>
        </div>
      </div>
    );
  }

  return (
    <div className="wifi-layout">
      <div className="card card-pad">
        <h2 className="section-title">Status</h2>
        <p className="sub mac">
          {link.deviceId ? formatMac(link.deviceId) : '—'}
          {link.transport ? ` · ${transportLabel(link.transport)}` : ''}
        </p>
        <dl className="kv">
          <dt>Status</dt>
          <dd>{wifiStateLabel(link.wifiState, link.wifiConnecting)}</dd>
          <dt>Network</dt>
          <dd>{dash(link.wifiSsid)}</dd>
          <dt>Signal</dt>
          <dd>{wifiSignalLabel(link.wifiRssi)}</dd>
          <dt>Address</dt>
          <dd className="tabular">{dash(link.wifiIp)}</dd>
          <dt>Router</dt>
          <dd className="tabular">{dash(link.wifiGateway)}</dd>
          <dt>Internet</dt>
          <dd>
            <span className={`dot ${link.wifiInternet ? 'ok' : 'off'}`} />
            {link.wifiInternet == null ? '—' : link.wifiInternet ? 'Yes' : 'No'}
          </dd>
        </dl>
        <div className="row mt">
          <Button disabled={busy !== null} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      </div>
      <div className="card card-pad">
        <h2 className="section-title">Join network</h2>
        <div className="stack mt">
          <Field label="Network">
            <select
              value={manual ? '__other__' : pick || ssid}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__other__') {
                  setManual(true);
                  setPick('');
                  return;
                }
                setManual(false);
                setPick(v);
                setSsid(v);
              }}
            >
              <option value="">Select a network</option>
              {networks.map((n) => (
                <option key={n.ssid} value={n.ssid}>
                  {n.ssid} — {wifiSignalLabel(n.rssi)} · {wifiAuthLabel(n.auth)}
                </option>
              ))}
              <option value="__other__">Other…</option>
            </select>
          </Field>
          {manual ? (
            <Field label="Network name">
              <input value={ssid} onChange={(e) => setSsid(e.target.value)} autoComplete="off" />
            </Field>
          ) : null}
          {needsPass ? (
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          ) : (
            <p className="hint">This network does not need a password.</p>
          )}
        </div>
        <div className="row mt">
          <Button disabled={busy !== null} onClick={() => void scan()}>
            {busy === 'scan' ? 'Scanning…' : 'Scan'}
          </Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => void save()}>
            {busy === 'save' ? 'Saving…' : 'Connect'}
          </Button>
          <Button variant="ghost" disabled={busy !== null || !link.wifiSsid} onClick={() => void forget()}>
            Remove network
          </Button>
        </div>
        {note ? <p className="hint mt">{note}</p> : null}
        <div className="mt">
          <ErrorText>{err}</ErrorText>
        </div>
      </div>
    </div>
  );
}
