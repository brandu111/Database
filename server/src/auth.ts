import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { StaffLevel } from '@brandu/shared';
import type { DB } from './db.js';

/**
 * Cookie sessions signed with an HMAC secret persisted in the database.
 * Staff sessions carry a permission level enforced server-side on every
 * route; client-extranet sessions are scoped read-only to one company.
 */

export interface StaffSession {
  kind: 'staff';
  id: string;
  name: string;
  level: StaffLevel;
  exp: number;
}

export interface ClientSession {
  kind: 'client';
  company: string;
  exp: number;
}

export type Session = StaffSession | ClientSession;

const COOKIE = 'bu_session';
const SESSION_HOURS = 12;

export function getSecret(db: DB): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const row = db.prepare(`SELECT value FROM meta WHERE key='sessionSecret'`).get() as { value: string } | undefined;
  if (row) return row.value;
  const secret = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO meta(key,value) VALUES('sessionSecret',?)`).run(secret);
  return secret;
}

export function signToken(secret: string, session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(secret: string, token: string): Session | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function makeSession(partial: Omit<StaffSession, 'exp'> | Omit<ClientSession, 'exp'>): Session {
  return { ...partial, exp: Date.now() + SESSION_HOURS * 3600 * 1000 } as Session;
}

export function setSessionCookie(res: Response, secret: string, session: Session): void {
  res.cookie(COOKIE, signToken(secret, session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE);
}

export function readSession(db: DB, req: Request): Session | null {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
  if (!token) return null;
  return verifyToken(getSecret(db), token);
}

const LEVEL_RANK: Record<StaffLevel, number> = {
  'Full Permissions': 3,
  'Edit Only': 2,
  'View and Print Only': 1,
  'No Access': 0,
};

export function rank(level: StaffLevel): number {
  return LEVEL_RANK[level] ?? 0;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

/** Gate a route on a staff session at or above the given permission level. */
export function requireStaff(db: DB, min: 'view' | 'edit' | 'full') {
  const need = min === 'full' ? 3 : min === 'edit' ? 2 : 1;
  return (req: Request, res: Response, next: NextFunction) => {
    const session = readSession(db, req);
    if (!session || session.kind !== 'staff') return res.status(401).json({ error: 'Not signed in' });
    if (rank(session.level) < need) return res.status(403).json({ error: 'Insufficient permissions' });
    req.session = session;
    next();
  };
}

/** Gate a portal route on a client-extranet session (read-only, one company). */
export function requireClient(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = readSession(db, req);
    if (!session || session.kind !== 'client') return res.status(401).json({ error: 'Not signed in' });
    req.session = session;
    next();
  };
}

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function checkPassword(pw: string, hash: string): boolean {
  if (!hash) return false;
  return bcrypt.compareSync(pw, hash);
}

/** Generate a client-extranet password (delivered once, stored hashed). */
export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = randomBytes(14);
  for (let i = 0; i < 14; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
