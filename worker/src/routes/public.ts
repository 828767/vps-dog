/**
 * Public read API (§4.2) — no authentication required.
 * `hidden = 1` nodes are invisible here except by direct `:id` for admins.
 *
 * These are reads, so they return the documented DTO shapes verbatim (no
 * `{ok:true}` envelope — §4 reserves that for mutations).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { optionalAuth } from '../auth';
import {
  getMetricSeries,
  getNode,
  getPingSummaries,
  getPublicStatus,
  getSettings,
  getUptimeSummaries,
  listNodes,
  listUptimeChecks,
  mapNodeSummary,
  type NodeRow,
} from '../db';
import type { AppEnv, NodeDetail, NodeSummary, PingTaskWithSeries, UptimeBoard } from '../types';
import { clampInt, json, notFound, nowSec } from '../util';

export const publicRoutes = new Hono<AppEnv>();

// Optional auth so `/api/nodes/:id` can reveal hidden nodes to admins only.
publicRoutes.use('*', optionalAuth);

/**
 * Resolve a node for a direct `:id` read. Hidden nodes 404 for public callers
 * and resolve normally for an authenticated admin (§4.2).
 */
async function resolveVisibleNode(c: Context<AppEnv>, id: string): Promise<NodeRow | null> {
  const node = await getNode(c.env.DB, id);
  if (!node) return null;
  if (Number(node.hidden) === 1 && !c.get('user')) return null;
  return node;
}

publicRoutes.get('/status', async (c) => {
  const now = nowSec();
  const settings = await getSettings(c.env.DB);
  return json(c, await getPublicStatus(c.env.DB, settings, now));
});

publicRoutes.get('/nodes', async (c) => {
  const now = nowSec();
  const settings = await getSettings(c.env.DB);
  const rows = await listNodes(c.env.DB, false);
  const nodes: NodeSummary[] = rows.map((row) => mapNodeSummary(row, settings.offline_after, now));
  const status = await getPublicStatus(c.env.DB, settings, now);
  return json(c, { nodes, status });
});

publicRoutes.get('/groups', async (c) => {
  const rows = await listNodes(c.env.DB, false);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.group_name || 'default';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const groups = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return json(c, { groups });
});

/**
 * Availability board for the website monitors (§4.2).
 *
 * Only enabled monitors are exposed: a disabled one is deliberately paused by
 * the operator and its last result is stale, so publishing it would claim an
 * outage that is not being verified.
 */
publicRoutes.get('/uptime', async (c) => {
  const now = nowSec();
  const monitors = await getUptimeSummaries(c.env.DB, now, false);
  const up = monitors.filter((monitor) => monitor.ok).length;
  const board: UptimeBoard = {
    monitors,
    summary: {
      total: monitors.length,
      up,
      down: monitors.length - up,
      generated_at: now,
    },
  };
  return json(c, board);
});

publicRoutes.get('/uptime/:id', async (c) => {
  const id = c.req.param('id');
  const now = nowSec();
  // Reuse the board query so the detail page gets the same rolling numbers as
  // the card it was opened from, and disabled monitors stay invisible.
  const monitors = await getUptimeSummaries(c.env.DB, now, false);
  const monitor = monitors.find((row) => row.id === id);
  if (!monitor) return notFound(c, 'Uptime monitor not found');
  const limit = clampInt(c.req.query('limit'), 1, 500, 200);
  const checks = await listUptimeChecks(c.env.DB, id, limit);
  return json(c, { monitor, checks });
});

publicRoutes.get('/nodes/:id/metrics', async (c) => {
  const id = c.req.param('id');
  const node = await resolveVisibleNode(c, id);
  if (!node) return notFound(c, 'Node not found');
  const series = await getMetricSeries(c.env.DB, id, c.req.query('hours'), nowSec());
  return json(c, series);
});

publicRoutes.get('/nodes/:id/pings', async (c) => {
  const id = c.req.param('id');
  const node = await resolveVisibleNode(c, id);
  if (!node) return notFound(c, 'Node not found');
  const hours = clampInt(c.req.query('hours'), 1, 168, 24);
  const pings: PingTaskWithSeries[] = await getPingSummaries(c.env.DB, id, nowSec(), hours);
  return json(c, { pings });
});

publicRoutes.get('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const now = nowSec();
  const node = await resolveVisibleNode(c, id);
  if (!node) return notFound(c, 'Node not found');
  const settings = await getSettings(c.env.DB);
  const summary = mapNodeSummary(node, settings.offline_after, now);
  const pings = await getPingSummaries(c.env.DB, id, now);
  const detail: NodeDetail = { ...summary, pings };
  return json(c, detail);
});
