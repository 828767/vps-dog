/**
 * Agent ingest — `POST /api/v1/report` (§4.1).
 */
import { Hono } from 'hono';
import { clientIp, readAgentToken } from '../auth';
import {
  accumulateMonthTraffic,
  coerceHostInfo,
  coerceSample,
  createNode,
  createPingTask,
  findPingTask,
  getNodeByTokenHash,
  getSettings,
  insertMetric,
  insertPingRecord,
  listPingTasks,
  setNodeSource,
  updateNode,
} from '../db';
import type { AppEnv, MetricSample } from '../types';
import {
  badRequest,
  bool,
  clampInt,
  err,
  nowSec,
  num,
  ok,
  parseJsonColumn,
  parseTags,
  readJsonBody,
  sha256hex,
  str,
} from '../util';

export const agentRoutes = new Hono<AppEnv>();

/** Reporting clock skew tolerance for an optional client-supplied `ts`. */
const TS_MAX_AGE = 7 * 86400;
const TS_MAX_FUTURE = 3600;

interface IncomingPing {
  name: string;
  type: string;
  target: string;
  value: number;
  ok: boolean;
}

/**
 * Normalise the optional `pings` array. Entries without a name and target are
 * dropped rather than failing the whole report.
 */
function coercePings(input: unknown): IncomingPing[] {
  if (!Array.isArray(input)) return [];
  const out: IncomingPing[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const name = str(entry.name).trim();
    const target = str(entry.target).trim();
    if (name === '' || target === '') continue;
    const value = num(entry.value, -1);
    out.push({
      name,
      type: str(entry.type, 'tcp').toLowerCase() || 'tcp',
      target,
      value,
      ok: 'ok' in entry ? bool(entry.ok) : value >= 0,
    });
  }
  return out;
}

agentRoutes.post('/report', async (c) => {
  const db = c.env.DB;
  const now = nowSec();

  // ── body ──────────────────────────────────────────────────────────────────
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');

  const rawMetrics = body.metrics;
  if (!rawMetrics || typeof rawMetrics !== 'object' || Array.isArray(rawMetrics)) {
    return badRequest(c, '`metrics` is required and must be an object');
  }
  const sample: MetricSample = coerceSample(rawMetrics as Record<string, unknown>);

  // Optional client timestamp (additive extension: the contract body has no
  // `ts`, but accepting one lets agents behind clock drift stay accurate).
  // Clamped so a bad clock cannot poison the series.
  let ts = now;
  if (body.ts !== undefined && body.ts !== null) {
    const candidate = Math.trunc(num(body.ts, now));
    ts = Math.min(now + TS_MAX_FUTURE, Math.max(now - TS_MAX_AGE, candidate));
  }

  // ── token → node ──────────────────────────────────────────────────────────
  const token = readAgentToken(c.req.raw);
  if (!token) return err(c, 401, 'unauthorized', 'Missing or malformed agent token');

  const tokenHash = await sha256hex(token);
  const settings = await getSettings(db);
  let node = await getNodeByTokenHash(db, tokenHash);

  if (!node) {
    if (!settings.allow_auto_register) {
      return err(c, 401, 'unauthorized', 'Unknown agent token');
    }
    const name = str(body.name).trim();
    if (name === '') {
      return badRequest(c, '`name` is required for first contact');
    }
    const host = (body.host && typeof body.host === 'object' && !Array.isArray(body.host)
      ? (body.host as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    node = await createNode(db, {
      name,
      tokenHash,
      tokenHint: token.slice(0, 8),
      group: 'default',
      region: str(host.region),
      tags: [str(host.os), str(host.arch)].filter((v) => v !== ''),
    });
  }

  // ── store the sample ──────────────────────────────────────────────────────
  await insertMetric(db, sample, node.id, ts);

  // The agent dials out from the monitored host, so the request's source
  // address is that host's public address. Recording it here means the
  // dashboard can show an IP without any agent change or re-install.
  // Cloudflare geolocates the source IP for free on every request
  // (`request.cf.country`, ISO-3166 alpha-2) — recorded alongside for the
  // dashboard's flag display, no external GeoIP service involved.
  const sourceIp = clientIp(c.req.raw);
  const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf;
  const country = typeof cf?.country === 'string' ? cf.country.toUpperCase() : '';
  if (sourceIp !== 'unknown' && (sourceIp !== str(node.ip) || country !== str(node.country))) {
    await setNodeSource(db, node.id, sourceIp, country);
  }

  const host = body.host && typeof body.host === 'object' && !Array.isArray(body.host)
    ? (body.host as Record<string, unknown>)
    : {};

  // Only move the denormalised "latest" forward so a late/out-of-order report
  // cannot regress the dashboard.
  const lastSeen = num(node.last_seen);
  if (ts >= lastSeen) {
    // Static hardware identity rides in the same `host` envelope; a report
    // without it keeps whatever was stored before (COALESCE).
    const hostInfo = coerceHostInfo(host);
    const hostInfoJson = hostInfo !== null ? JSON.stringify(hostInfo) : null;
    // Month-to-date traffic, folded from the cumulative counters against the
    // sample we are about to replace (see accumulateMonthTraffic).
    const prevSample = parseJsonColumn<Record<string, unknown> | null>(node.latest, null);
    const month = accumulateMonthTraffic(
      prevSample !== null ? coerceSample(prevSample) : null,
      sample,
      node,
      now,
    );
    await db
      .prepare(
        `UPDATE nodes SET latest = ?, last_seen = ?, updated_at = ?, host_info = COALESCE(?, host_info),
                traffic_month = ?, traffic_month_in = ?, traffic_month_out = ?
          WHERE id = ?`,
      )
      .bind(
        JSON.stringify(sample),
        ts,
        now,
        hostInfoJson,
        month.month,
        month.in,
        month.out,
        node.id,
      )
      .run();

    // `host` is captured once: fill region/tags only while they are still empty.
    const region = str(host.region);
    const osArch = [str(host.os), str(host.arch)].filter((v) => v !== '');
    if (region !== '' && str(node.region) === '') {
      await updateNode(db, node.id, { region });
    }
    if (osArch.length > 0 && parseTags(node.tags).length === 0) {
      await updateNode(db, node.id, { tags: osArch });
    }
  } else {
    await db.prepare('UPDATE nodes SET updated_at = ? WHERE id = ?').bind(now, node.id).run();
  }

  // ── pings ─────────────────────────────────────────────────────────────────
  const incoming = coercePings(body.pings);
  for (const ping of incoming) {
    let task = await findPingTask(db, node.id, ping.name, ping.target);
    if (!task) {
      // Unknown probes are auto-created for this node (§4.1).
      task = await createPingTask(db, {
        node_id: node.id,
        name: ping.name,
        type: ping.type,
        target: ping.target,
        interval: 60,
        enabled: true,
      });
    }
    await insertPingRecord(db, task.id, node.id, ts, ping.value, ping.ok);
  }

  // ── response: the node's enabled tasks, which the agent then probes ───────
  const tasks = await listPingTasks(db, node.id);
  return ok(c, {
    node_id: node.id,
    server_time: now,
    interval: clampInt(settings.report_interval, 10, 3600, 30),
    pings: tasks
      .filter((t) => bool(t.enabled, true))
      .map((t) => ({ id: t.id, name: t.name, type: t.type, target: t.target, interval: num(t.interval, 60) })),
  });
});
