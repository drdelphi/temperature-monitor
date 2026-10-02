import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

/* Nest already reads ../../.env. Next only looks in apps/web/, so copy NEXT_PUBLIC_*
   from the repo-root file unless a more specific apps/web/.env* already set them. */
try {
  for (const line of readFileSync(resolve(__dirname, '../../.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
  }
} catch {
  /* CI / Docker may not have a root .env next to the app. */
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  /* next dev -H 0.0.0.0 is opened from phones/laptops as http://192.168.x.x:3000.
     Next treats that as a cross-origin /_next/* request unless the LAN host is listed. */
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
  ],
};

export default nextConfig;
