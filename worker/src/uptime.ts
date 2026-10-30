/**
 * Uptime monitors: HTTP availability checks of websites, performed by the
 * Worker itself rather than by an agent.
 *
 * Why the worker: an uptime check has to work precisely when your server is
 * down, so it cannot depend on an agent running on that server. The cron
 * trigger fires every minute and each monitor is probed once its own
 * `interval` has elapsed.
 *
 * This module is deliberately self-contained (no `db.ts` import) so the pure
 * helpers can be reused by `db.ts` without a circular import.
 */
import type { Env, UptimeProbeResult, UptimeRunCounts } from './types';
import { clampInt, nowSec, num, str } from './util';

// ── limits ──────────────────────────────────────────────────────────────────

export const UPTIME_DEFAULT_INTERVAL = 300;
export const UPTIME_MIN_INTERVAL = 60;
export const UPTIME_MAX_INTERVAL = 86_400;
export const UPTIME_DEFAULT_TIMEOUT = 10_000;
export const UPTIME_MIN_TIMEOUT = 1_000;
export const UPTIME_MAX_TIMEOUT = 30_000;

/**
 * Probes per cron tick.
 *
 * A Workers invocation may issue at most 50 subrequests on the free plan, and
 * D1 statements count against that budget too: each probe is one `fetch`, and
 * each result costs two bound statements. Ten probes therefore tops out around
 * 31 subrequests, leaving room for the notify scan that runs afterwards.
 *
 * Monitors are picked oldest-check-first, so a backlog drains across ticks
 * instead of starving the same monitors every minute.
 */
const MAX_PROBES_PER_TICK = 10;

// ── expected status ─────────────────────────────────────────────────────────

/**
 * Normalise an expected-status spec.
 *
 * Accepted forms: `2xx` (any code in the class), an exact three-digit code
 * (`200`), or a comma-separated mix (`200,204`). Anything unrecognised is
 * dropped; an empty result falls back to `2xx`, which is what a monitor means
 * when the operator has not chosen anything.
 */
export function normalizeExpectedStatus(value: unknown): string {
  const raw = str(value).trim().toLowerCase();
  if (raw === '') return '2xx';
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const m = /^([1-5])(xx|\d\d)$/.exec(part.trim());
    if (m === null) continue;
    const code = m[2] === 'xx' ? `${m[1]}xx` : `${m[1]}${m[2]}`;
    if (!out.includes(code)) out.push(code);
  }
  return out.length > 0 ? out.join(',') : '2xx';
}

/** True when `status` satisfies the (already normalised) `expected` spec. */
export function statusMatches(status: number, expected: string): boolean {
  if (!Number.isFinite(status) || status <= 0) return false;
  for (const part of normalizeExpectedStatus(expected).split(',')) {
    if (part.endsWith('xx')) {
      if (Math.trunc(status / 100) === Number(part[0])) return true;
    } else if (status === Number(part)) {
      return true;
    }
  }
  return false;
}

// ── target validation ───────────────────────────────────────────────────────

/** Hostnames that must never be probed, whatever the operator types. */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
]);

/**
 * Refuse addresses that only make sense inside a private network. Workers
 * cannot reach most of these anyway, but an explicit check turns a confusing
 * 10-second timeout into a clear 400 at the API edge.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === '') return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 !== null) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  // Any IPv6 literal is refused: ::1, fc00::/7 and fe80::/10 all live here and
  // a public v6 monitor is rare enough not to justify parsing every range.
  if (host.includes(':')) return true;
  return false;
}

/**
 * Validate and normalise a monitor URL. Returns `null` when it is not a public
 * http(s) URL; a bare host gets `https://` prepended.
 */
export function normalizeMonitorUrl(value: unknown): string | null {
  const raw = str(value).trim();
  if (raw === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Credentials in the URL would be stored in plain text and shown in the UI.
  if (url.username !== '' || url.password !== '') return null;
  if (isPrivateHost(url.hostname)) return null;
  return url.toString();
}

/** Display name used when the operator leaves `name` empty. */
export function defaultMonitorName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ── probe ───────────────────────────────────────────────────────────────────

export interface ProbeOptions {
  method?: unknown;
  expected?: unknown;
  timeoutMs?: unknown;
}

/**
 * Turn a thrown fetch error into something an operator can act on.
 *
 * `fetch()` rejects with a bare `TypeError: fetch failed` and hides the real
 * problem in `cause`, so a naive `e.message` would show "fetch failed" for a
 * DNS typo, a TLS failure and a refused connection alike.
 */
function describeFetchError(e: unknown, timeoutMs: number): string {
  const parts: string[] = [];
  let current: unknown = e;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) {
      if (current.name === 'TimeoutError' || current.name === 'AbortError') {
        return `timeout after ${timeoutMs} ms`;
      }
      if (current.message !== '' && !parts.includes(current.message)) parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      const text = String(current);
      if (text !== '' && !parts.includes(text)) parts.push(text);
      break;
    }
  }
  const message = parts.join(': ');
  if (/timeout|timed out|aborted/i.test(message)) return `timeout after ${timeoutMs} ms`;
  // workerd hides DNS/TLS/connection failures behind an opaque
  // "internal error; reference = …" string, which tells an operator nothing.
  // Name the likely causes instead of surfacing that token.
  if (/internal error|reference =|network connection lost|connection refused|dns/i.test(message)) {
    return 'connection failed (DNS or network error)';
  }
  return message !== '' ? message : 'request failed';
}

/**
 * Request `url` once and report what came back.
 *
 * Never throws: a DNS failure, TLS error or timeout is a legitimate "down"
 * result and is returned as `ok: false` with `status: 0` and the reason in
 * `error`, so callers can store it as a check row without special-casing.
 */
export async function probeUrl(url: string, options: ProbeOptions = {}): Promise<UptimeProbeResult> {
  const method = str(options.method).trim().toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
  const expected = normalizeExpectedStatus(options.expected);
  const timeoutMs = clampInt(options.timeoutMs, UPTIME_MIN_TIMEOUT, UPTIME_MAX_TIMEOUT, UPTIME_DEFAULT_TIMEOUT);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      headers: {
        // A browser-ish UA: plenty of sites answer 403 to unknown clients,
        // which would read as a false outage.
        'user-agent': 'Mozilla/5.0 (compatible; VPS-DOG/1.0 uptime monitor)',
        accept: '*/*',
        'cache-control': 'no-cache',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latency = Date.now() - started;
    // The body is irrelevant to an availability check and a large page would
    // only burn CPU and memory, so drop it instead of buffering.
    try {
      await res.body?.cancel();
    } catch {
      /* already closed */
    }
    const ok = statusMatches(res.status, expected);
    return {
      url,
      ok,
      status: res.status,
      latency_ms: latency,
      final_url: res.url !== '' ? res.url : url,
      error: ok ? '' : `unexpected status ${res.status}`,
      expected_status: expected,
    };
  } catch (e: unknown) {
    return {
      url,
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      final_url: url,
      error: describeFetchError(e, timeoutMs).slice(0, 200),
      expected_status: expected,
    };
  }
}

// ── persistence ─────────────────────────────────────────────────────────────

/**
 * Store one probe result: append the history row and refresh the denormalised
 * columns on the monitor.
 *
 * `notified_down` is left untouched — it is the notifier's send-state (see
 * notify.ts) and must only move once a message was actually delivered.
 */
export async function recordUptimeResult(
  db: D1Database,
  monitorId: string,
  result: UptimeProbeResult,
  ts: number,
): Promise<void> {
  const okFlag = result.ok ? 1 : 0;
  await db.batch([
    db
      .prepare(
        `INSERT INTO uptime_checks (monitor_id, ts, status, latency, ok, error)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(monitor_id, ts) DO UPDATE SET
           status = excluded.status, latency = excluded.latency,
           ok = excluded.ok, error = excluded.error`,
      )
      .bind(monitorId, ts, result.status, Math.max(0, Math.trunc(result.latency_ms)), okFlag, result.error),
    db
      .prepare(
        `UPDATE uptime_monitors
            SET last_checked = ?, last_status = ?, last_latency = ?, last_ok = ?, last_error = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        ts,
        result.status,
        Math.max(0, Math.trunc(result.latency_ms)),
        okFlag,
        result.error,
        ts,
        monitorId,
      ),
  ]);
}

// ── cron pass ───────────────────────────────────────────────────────────────

interface DueMonitorRow {
  id: string;
  url: string;
  method: string;
  interval: number;
  expected_status: string;
  timeout_ms: number;
  last_checked: number;
}

/**
 * Probe every enabled monitor whose interval has elapsed.
 *
 * Called on each one-minute cron tick. Because the check is "due or not", a
 * monitor with a 5-minute interval is probed every fifth tick and a second
 * invocation in the same minute is a no-op — which also makes the function
 * safe to call from a manual endpoint.
 */
export async function runUptimeChecks(env: Env, now = nowSec()): Promise<UptimeRunCounts> {
  const res = await env.DB
    .prepare(
      `SELECT id, url, method, interval, expected_status, timeout_ms, last_checked
         FROM uptime_monitors
        WHERE enabled = 1
        ORDER BY last_checked ASC
        LIMIT 200`,
    )
    .all<DueMonitorRow>();
  const rows = res.results ?? [];

  const due = rows.filter((row) => {
    const interval = clampInt(row.interval, UPTIME_MIN_INTERVAL, UPTIME_MAX_INTERVAL, UPTIME_DEFAULT_INTERVAL);
    const last = num(row.last_checked);
    return last === 0 || last + interval <= now;
  });

  const batch = due.slice(0, MAX_PROBES_PER_TICK);
  const results = await Promise.all(
    batch.map(async (row) => ({
      row,
      result: await probeUrl(row.url, {
        method: row.method,
        expected: row.expected_status,
        timeoutMs: row.timeout_ms,
      }),
    })),
  );

  let up = 0;
  for (const item of results) {
    if (item.result.ok) up++;
    await recordUptimeResult(env.DB, item.row.id, item.result, now);
  }

  return {
    checked: results.length,
    up,
    down: results.length - up,
    skipped: rows.length - results.length,
  };
}
