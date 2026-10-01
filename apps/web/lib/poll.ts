'use client';

import { useEffect } from 'react';

/**
 * Calls `tick` now and every `periodMs`, but only while the tab is in front.
 * A dashboard left open on a phone should not keep spending battery and mobile
 * data in the background; coming back to it refreshes straight away.
 *
 * `tick` has to be stable — wrap it in useCallback.
 */
export function useVisiblePolling(tick: () => void, periodMs: number): void {
  useEffect(() => {
    let timer = 0;

    const stop = () => window.clearInterval(timer);

    const start = () => {
      tick();
      timer = window.setInterval(tick, periodMs);
    };

    const onVisibility = () => {
      stop();
      if (!document.hidden) start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tick, periodMs]);
}

/**
 * Calls `refresh` when the tab comes back to the front or the network returns,
 * which is how a phone usually rejoins: screen off, app switched, Wi-Fi to cell.
 *
 * `refresh` has to be stable — wrap it in useCallback.
 */
export function useForegroundRefresh(refresh: () => void): void {
  useEffect(() => {
    const fire = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', fire);
    window.addEventListener('online', fire);
    return () => {
      document.removeEventListener('visibilitychange', fire);
      window.removeEventListener('online', fire);
    };
  }, [refresh]);
}
