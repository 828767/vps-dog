/**
 * Retention + offline sweep, shared by the cron trigger and
 * `POST /api/admin/sweep` (§4.4 / item 12).
 *
 * `metrics` and `ping_records` are WITHOUT ROWID tables, so chunked deletes
 * cannot use `rowid`. Instead each pass finds a bounded `ts` ceiling and deletes
 * everything at or below it, which keeps every statement small and bounded.
 */
import { getSettings } from './db';
import type { Env, SweepCounts } from './types';
import { nowSec } from './util';

/** `ts` values (≈ rows, one per node per tick) handled per DELETE statement. */
const DELETE_CHUNK = 500;
/** Safety valve so a huge backlog cannot run forever in one invocation. */
const MAX_CHUNKS = 200;

function changeCount(res: D1Result): number {
  const meta = res.meta as { changes?: number } | undefined;
  return typeof meta?.changes === 'number' ? meta.changes : 0;
}

/**
 * Delete rows with `ts < cutoff` in bounded batches. Returns rows deleted.
 *
 * Each iteration locates the CHUNK-th oldest `ts` still below the cutoff. If
 * that exists, everything `<= that ts` is deleted (a bounded slice); if it does
 * not exist, fewer than CHUNK timestamps remain and the rest go in one pass.
 */
async function purgeByTs(
  db: D1Database,
  table: 'metrics' | 'ping_records' | 'uptime_checks',
  cutoff: number,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const boundary = await db
      .prepare(`SELECT ts FROM ${table} WHERE ts < ? ORDER BY ts ASC LIMIT 1 OFFSET ${DELETE_CHUNK - 1}`)
      .bind(cutoff)
      .first<{ ts: number }>();

    if (!boundary) {
      const res = await db.prepare(`DELETE FROM ${table} WHERE ts < ?`).bind(cutoff).run();
      total += changeCount(res);
      break;
    }

    const res = await db.prepare(`DELETE FROM ${table} WHERE ts <= ?`).bind(boundary.ts).run();
    const removed = changeCount(res);
    total += removed;
    if (removed === 0) break;
  }
  return total;
}

/**
 * Run the full sweep: purge old metrics and ping records and drop expired
 * sessions.
 *
 * Note there is deliberately no "mark nodes offline" step: `online` is derived
 * from `last_seen` at read time (`isOnline()` in db.ts), so a stored flag would
 * be a second source of truth that could disagree with the first. The
 * `nodes.online` column is kept only as an ingest-side marker and is never
 * consulted for the online/offline decision.
 */
export async function runSweep(env: Env, now = nowSec()): Promise<SweepCounts> {
  const db = env.DB;
  const settings = await getSettings(db);

  const metricsCutoff = now - Math.max(0, settings.retention_days) * 86400;
  const pingCutoff = now - Math.max(0, settings.ping_retention_days) * 86400;
  // Uptime history shares the metric retention window: it is one small row per
  // monitor per interval, so a separate knob would only add a setting nobody
  // tunes independently.
  const uptimeCutoff = metricsCutoff;

  const metricsDeleted = await purgeByTs(db, 'metrics', metricsCutoff);
  const pingDeleted = await purgeByTs(db, 'ping_records', pingCutoff);
  const uptimeDeleted = await purgeByTs(db, 'uptime_checks', uptimeCutoff);

  const sessionRes = await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  const sessionsDeleted = changeCount(sessionRes);

  return {
    metrics_deleted: metricsDeleted,
    ping_records_deleted: pingDeleted,
    uptime_checks_deleted: uptimeDeleted,
    sessions_deleted: sessionsDeleted,
    nodes_marked_offline: 0,
  };
}
