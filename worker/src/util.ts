/**
 * Small shared helpers: ids, hashing, JSON responses, numeric coercion.
 */
import type { Context } from 'hono';

// ── ids / randomness ────────────────────────────────────────────────────────

/** UUID v4 (crypto.randomUUID is available in Workers and in workerd tests). */
export function uuid(): string {
  return crypto.randomUUID();
}

/** `bytes` random bytes as lowercase hex. */
export function randomHex(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let out = '';
  for (const b of buf) out += b.toString(16).padStart(2, '0');
  return out;
}

/** SHA-256 of a UTF-8 string, lowercase hex. Used for agent token lookup. */
export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let out = '';
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, '0');
  return out;
}

// ── base64 ──────────────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Length-independent, value-constant-time byte comparison. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// ── time ────────────────────────────────────────────────────────────────────

/** Current Unix epoch seconds. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── responses ───────────────────────────────────────────────────────────────

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

/**
 * Loose context type for the response helpers.
 *
 * Every response MUST be built through the Hono context (`c.newResponse`), not
 * with a bare `new Response()`. Hono keeps headers set by helpers such as
 * `setCookie()` in `context.#preparedHeaders` and only merges them when the
 * handler responds through the context; returning a raw `Response` silently
 * drops them, which would break session login.
 */
export type AnyContext = Context<any, any, any>;

export function json(
  c: AnyContext,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return c.newResponse(JSON.stringify(data), status as never, {
    ...JSON_HEADERS,
    'x-content-type-options': 'nosniff',
    ...headers,
  });
}

/** `{ ok: true, ...extra }` success envelope for mutations. */
export function ok(c: AnyContext, extra: object = {}, status = 200): Response {
  return json(c, { ok: true, ...extra }, status);
}

/** `{ error, message }` error envelope (§4). */
export function err(
  c: AnyContext,
  status: number,
  error: string,
  message?: string,
  headers: Record<string, string> = {},
): Response {
  return json(c, { error, message: message ?? error }, status, headers);
}

export const badRequest = (c: AnyContext, message = 'Malformed request body') =>
  err(c, 400, 'bad_request', message);
export const unauthorized = (c: AnyContext, message = 'Authentication required') =>
  err(c, 401, 'unauthorized', message);
export const forbidden = (c: AnyContext, message = 'Forbidden') => err(c, 403, 'forbidden', message);
export const notFound = (c: AnyContext, message = 'Not found') => err(c, 404, 'not_found', message);

/**
 * Parse a JSON request body. Returns `null` when the body is not a JSON object
 * (malformed JSON, arrays, primitives, empty body).
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ── coercion ────────────────────────────────────────────────────────────────

/** Coerce anything numeric-ish to a finite number, else `fallback` (default 0). */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    if (value.trim() === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return fallback;
}

/** Coerce to a truncated integer clamped into [min, max]. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(num(value, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerce to boolean-ish. Empty/unknown strings fall back. */
export function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === '') return fallback;
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off'].includes(s)) return false;
  }
  return fallback;
}

/** Coerce to a trimmed string. */
export function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/**
 * Parse a tag list. Accepts a JSON array, a JSON-encoded array string, or a
 * comma-separated string. Always returns `string[]`.
 */
export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => str(v).trim()).filter((v) => v.length > 0);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return [];
    if (s.startsWith('[')) {
      try {
        return parseTags(JSON.parse(s) as unknown);
      } catch {
        return [];
      }
    }
    return s
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

/** JSON-encode a tag list defensively (never throws). */
export function tagsToJson(tags: string[]): string {
  try {
    return JSON.stringify(tags);
  } catch {
    return '[]';
  }
}

/** Parse a JSON string column defensively. */
export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** `true` for a 64-char lowercase/uppercase hex string. */
export function isHexToken(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}
