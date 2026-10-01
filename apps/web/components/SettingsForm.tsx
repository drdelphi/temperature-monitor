'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { type OperatorSettings, normalizeSettings } from '@/lib/types';
import { PasswordForm } from './PasswordForm';
import { Button, ErrorText, Field } from './ui';

const EMPTY: OperatorSettings = { phoneE164: '', telegramChatId: '', telegramBotTokenSet: false };

export function SettingsForm() {
  const [form, setForm] = useState<OperatorSettings>(EMPTY);
  const [botToken, setBotToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setForm(normalizeSettings(await apiGet('/v1/settings')));
      } catch (e) {
        setErr(errorMessage(e));
      }
    })();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const body: Record<string, string | null> = {
        phoneE164: form.phoneE164.trim() || null,
        telegramChatId: form.telegramChatId.trim() || null,
      };
      if (clearToken) {
        body.telegramBotToken = null;
      } else if (botToken.trim()) {
        body.telegramBotToken = botToken.trim();
      }
      const next = normalizeSettings(await apiSend('/v1/settings', 'PATCH', body));
      setForm(next);
      setBotToken('');
      setClearToken(false);
      setSaved(true);
    } catch (error) {
      setErr(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Where to send temperature alerts.</p>
        </div>
      </div>
      <form className="card card-pad form-card stack" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Phone number">
          <input
            value={form.phoneE164}
            onChange={(e) => setForm((f) => ({ ...f, phoneE164: e.target.value }))}
            placeholder="+15551234567"
            autoComplete="tel"
          />
        </Field>
        <Field label="Telegram ID">
          <input
            value={form.telegramChatId}
            onChange={(e) => setForm((f) => ({ ...f, telegramChatId: e.target.value }))}
            placeholder="123456789"
          />
        </Field>
        <p className="hint">
          Open the Telegram bot and send /start. It replies with a number — paste that here so temperature
          alerts can reach you.
        </p>
        <Field label="Telegram bot token">
          <input
            type="password"
            value={clearToken ? '' : botToken}
            onChange={(e) => {
              setClearToken(false);
              setBotToken(e.target.value);
            }}
            placeholder={form.telegramBotTokenSet ? 'Token saved — paste a new one to replace' : '123456:ABC…'}
            autoComplete="off"
            disabled={clearToken}
          />
        </Field>
        {form.telegramBotTokenSet ? (
          <label className="check">
            <input
              type="checkbox"
              checked={clearToken}
              onChange={(e) => {
                setClearToken(e.target.checked);
                if (e.target.checked) setBotToken('');
              }}
            />
            Remove saved bot token
          </label>
        ) : (
          <p className="hint">From BotFather. Leave blank if you already set TELEGRAM_BOT_TOKEN on the server.</p>
        )}
        <div className="row">
          <Button variant="primary" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {saved ? <span className="hint">Saved</span> : null}
        </div>
        <ErrorText>{err}</ErrorText>
      </form>
      <div className="section">
        <PasswordForm />
      </div>
    </>
  );
}
