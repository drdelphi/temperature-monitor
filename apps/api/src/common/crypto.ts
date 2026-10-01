import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import * as argon2 from 'argon2';

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

export async function verifyDeviceToken(token: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('$argon2')) {
    try {
      return await argon2.verify(storedHash, token);
    } catch {
      return false;
    }
  }
  const a = Buffer.from(hashDeviceToken(token), 'hex');
  try {
    const b = Buffer.from(storedHash, 'hex');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}
