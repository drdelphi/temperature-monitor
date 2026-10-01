import type { Request } from 'express';
import type { Device, User } from '@prisma/client';

export type AuthKind = 'operator' | 'device';

export type AuthRequest = Request & {
  user?: User;
  device?: Device;
  authKind?: AuthKind;
};
