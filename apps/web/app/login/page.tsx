'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { apiSend } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { Button, ErrorText, Field } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiSend('/v1/auth/login', 'POST', { email, password });
      router.replace('/');
    } catch (error) {
      setErr(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/logo-thermometer.svg" alt="" className="login-logo" width={64} height={64} />
        <h1>Temperature monitor</h1>
        <p className="sub">Sign in to continue</p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <Field label="Email">
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <ErrorText>{err}</ErrorText>
          <Button variant="primary" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
