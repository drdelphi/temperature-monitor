'use client';

import { useEffect, useState } from 'react';

/** Matches the phone breakpoint in globals.css. */
export const NARROW_MAX_WIDTH = 720;

/**
 * True on phone-width screens. Starts false so the server markup and the first
 * client paint agree, then settles after mount.
 */
export function useNarrowViewport(maxWidth = NARROW_MAX_WIDTH): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [maxWidth]);

  return narrow;
}
