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
  /* Always start not-ready so SSR and the first client paint share the same busy
     markup. usePathname() can disagree across that boundary on a phone. */
  const [ready, setReady] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

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

  if (!ready) {
    return <div className="busy">Checking your sign-in…</div>;
  }

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className={`app-shell${navOpen ? ' nav-open' : ''}`}>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={navOpen}
        aria-controls="app-sidebar"
        aria-label={navOpen ? 'Close the monitor menu' : 'Open the monitor menu'}
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
