'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { requestLeave } from '@/lib/leave-guard';
import { linkSession } from '@/lib/link-session';
import { AppSidebar } from './AppSidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/login';
  const [ready, setReady] = useState(isLogin);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await apiGet('/v1/auth/me');
        if (!cancelled) {
          setReady(true);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLogin, router]);

  useEffect(() => {
    if (!ready || isLogin) return;
    void linkSession.tryAutoConnectUsb();
  }, [ready, isLogin]);

  async function logout() {
    requestLeave(() => {
      void (async () => {
        try {
          await apiSend('/v1/auth/logout', 'POST');
        } catch {
          /* cookie may already be gone */
        }
        router.replace('/login');
      })();
    });
  }

  if (isLogin) {
    return <>{children}</>;
  }

  if (!ready) {
    return <div className="busy">Checking your sign-in…</div>;
  }

  return (
    <div className={`app-shell${navOpen ? ' nav-open' : ''}`}>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={navOpen}
        onClick={() => setNavOpen((o) => !o)}
      >
        {navOpen ? 'Close' : 'Menu'}
      </button>
      {navOpen ? <button type="button" className="nav-backdrop" aria-label="Close menu" onClick={() => setNavOpen(false)} /> : null}
      <AppSidebar onLogout={() => void logout()} />
      <div className="main">{children}</div>
    </div>
  );
}
