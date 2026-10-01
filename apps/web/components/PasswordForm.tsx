'use client';

import { FormEvent, useState } from 'react';
import { apiSend } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { Button, ErrorText, Field } from './ui';

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    if (newPassword.length < 8) {
      setErr('Use at least 8 characters for the new password.');
      return;
    }
    if (newPassword !== confirm) {
      setErr('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiSend('/v1/auth/password', 'POST', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setSaved(true);
    } catch (error) {
      setErr(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="password" className="card card-pad form-card stack" onSubmit={(e) => void onSubmit(e)}>
      <h2 className="section-title">Change password</h2>
      <Field label="Current password">
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </Field>
      <Field label="New password">
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
        />
      </Field>
      <Field label="Confirm new password">
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
        />
      </Field>
      <div className="row">
        <Button variant="primary" disabled={busy} type="submit">
          {busy ? 'Saving…' : 'Change password'}
        </Button>
        {saved ? <span className="hint">Password updated</span> : null}
      </div>
      <ErrorText>{err}</ErrorText>
    </form>
  );
}
