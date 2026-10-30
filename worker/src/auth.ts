/**
 * Password hashing, sessions, agent tokens, auth middleware and login rate limiting.
 *
 * Password format (§5): `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`
 *   PBKDF2-SHA256, 100_000 iterations, 16-byte salt, 32-byte key, WebCrypto.
 */
import type { Context, MiddlewareHandler, Next } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import {
  createSession,
  deleteSession,
  getSessionUser,
  type UserRow,
} from './db';
import type { AppEnv, Env, SessionUser } from './types';
import { fromBase64, isHexToken, nowSec, randomHex, sha256hex, str, timingSafeEqual, toBase64 } from './util';

// ── constants ───────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'vpsdog_session';
export const SESSION_TTL_SECONDS = 604800; // 7 days (§5)
export const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256; // 32-byte key

/**
 * PBKDF2 iteration count.
 *
 * Production default is 100_000 (§5). The `AUTH_ITERATIONS` env override exists
 * so the test suite (and optionally `wrangler dev`) does not spend ~100 ms of
 * CPU per login; `wrangler.test.toml` sets it to 1000. It never weakens a
 * deployed Worker unless the operator explicitly sets the variable.
 */
export function iterationsFromEnv(env: Partial<Env> | undefined): number {
  const raw = env?.AUTH_ITERATIONS;
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 10_000_000) return n;
  return DEFAULT_ITERATIONS;
}

// ── password hashing ────────────────────────────────────────────────────────

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
  bits = KEY_BITS,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    bits,
  );
  return new Uint8Array(derived);
}

/** Hash a password into the §5 wire format. */
export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Verify a password against a stored hash. Constant-time on the derived key.
 * Returns false for any malformed stored hash instead of throwing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = str(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2] ?? '');
    expected = fromBase64(parts[3] ?? '');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await derive(password, salt, iterations, expected.length * 8);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── agent tokens ────────────────────────────────────────────────────────────

export interface IssuedToken {
  token: string; // plaintext, 64 hex chars — returned once
  tokenHash: string;
  tokenHint: string;
}

/** 32 random bytes → 64 hex chars; only the sha256 hex is stored (§5). */
export async function issueAgentToken(): Promise<IssuedToken> {
  const token = randomHex(32);
  return { token, tokenHash: await sha256hex(token), tokenHint: token.slice(0, 8) };
}

/** Extract the agent token from `Authorization: Bearer` or `X-Node-Token`. */
export function readAgentToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match && match[1]) {
      const value = match[1].trim();
      if (isHexToken(value)) return value;
    }
  }
  const nodeToken = req.headers.get('x-node-token');
  if (nodeToken && isHexToken(nodeToken.trim())) return nodeToken.trim();
  return null;
}

// ── session helpers ─────────────────────────────────────────────────────────

export interface IssuedSession {
  id: string;
  expiresAt: number;
}

export async function issueSession(db: D1Database, userId: string): Promise<IssuedSession> {
  const id = randomHex(32);
  await createSession(db, id, userId, SESSION_TTL_SECONDS);
  return { id, expiresAt: nowSec() + SESSION_TTL_SECONDS };
}

/** Write the session cookie with the §5 attributes. */
export function setSessionCookie(c: Context<AppEnv>, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'Lax' });
}

/** Session id from the cookie or `Authorization: Bearer <session-id>`. */
export function readSessionId(req: Request): string | null {
  const cookie = parseCookie(req.headers.get('cookie'), SESSION_COOKIE);
  if (cookie) return cookie;
  const header = req.headers.get('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

/** Read one cookie value out of a raw `Cookie` header. */
export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

export function toSessionUser(user: UserRow): SessionUser {
  return { id: user.id, username: user.username, role: user.role };
}

/** Resolve the current user, or null. Never throws. */
export async function resolveUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const sessionId = readSessionId(c.req.raw);
  if (!sessionId) return null;
  const user = await getSessionUser(c.env.DB, sessionId);
  return user ? toSessionUser(user) : null;
}

/**
 * Optional-auth middleware: populates `c.var.user` when a valid session is
 * present and always continues. Used by `/api/nodes/:id` so admins can see
 * hidden nodes while the public gets 404.
 */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', await resolveUser(c));
  await next();
};

/** Strict auth for `/api/admin/*` and `/api/auth/password`. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await resolveUser(c);
  if (!user) {
    return c.json({ error: 'unauthorized', message: 'Authentication required' }, 401);
  }
  c.set('user', user);
  await next();
};

/**
 * Role gate. Mount after `requireAuth`, which is what populates `c.var.user`.
 *
 * Roles are `admin` (full control) and `viewer` (read-only). The SPA hides
 * mutating controls from viewers, but this is the enforcement point — never
 * rely on the client.
 */
export function requireAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'unauthorized', message: 'Authentication required' }, 401);
    }
    if (user.role !== 'admin') {
      return c.json({ error: 'forbidden', message: 'Administrator role required' }, 403);
    }
    await next();
  };
}

/** Narrow a resolved user to a non-null value inside a handler. */
export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get('user');
  if (!user) throw new Error('requireAuth middleware missing');
  return user;
}

export async function logoutSession(c: Context<AppEnv>): Promise<void> {
  const sessionId = readSessionId(c.req.raw);
  if (sessionId) await deleteSession(c.env.DB, sessionId);
  clearSessionCookie(c);
}

// ── login rate limiting (§5) ────────────────────────────────────────────────

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory, per-isolate limiter (best effort, documented in §5). Cloudflare may
 * run many isolates, so this is a speed bump rather than a hard guarantee.
 */
const loginAttempts = new Map<string, RateBucket>();

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
  remaining: number;
}

export function checkLoginRateLimit(ip: string, now = Date.now()): RateLimitResult {
  const bucket = loginAttempts.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)), remaining: 0 };
  }
  bucket.count += 1;
  return { allowed: true, retryAfter: 0, remaining: RATE_LIMIT_MAX - bucket.count };
}

/** Forget the counter for an IP (called after a successful login). */
export function resetLoginRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

/** Test helper: drop all counters. */
export function clearLoginRateLimits(): void {
  loginAttempts.clear();
}

// ── bootstrap (§4.3) ────────────────────────────────────────────────────────

/** Password for the initial `admin` user; defaults to "admin" when unset. */
export function bootstrapPassword(env: Partial<Env> | undefined): string {
  const raw = env?.ADMIN_PASSWORD;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'admin';
}

export type { Next };
