/**
 * Auth API (§4.3) and Admin API (§4.4).
 *
 * Everything under `/api/admin/*` requires a session; `/api/auth/password`
 * requires a session too. Every mutating admin call writes an `audit_logs` row.
 */
import { Hono } from 'hono';
import {
  bootstrapPassword,
  checkLoginRateLimit,
  clientIp,
  currentUser,
  hashPassword,
  issueAgentToken,
  issueSession,
  iterationsFromEnv,
  logoutSession,
  optionalAuth,
  requireAdmin,
  requireAuth,
  resetLoginRateLimit,
  setSessionCookie,
  toSessionUser,
  verifyPassword,
} from '../auth';
import { runSweep } from '../cron';
import {
  countAdmins,
  countUsers,
  createNode,
  createPingTask,
  createUptimeMonitor,
  createUser,
  deleteNode,
  deletePingTask,
  deleteUptimeMonitor,
  deleteUser,
  getNode,
  getNodeByName,
  getOverview,
  getPingTask,
  getSettings,
  getUptimeMonitor,
  getUptimeSummaries,
  getUserById,
  getUserByUsername,
  listAudit,
  listNodes,
  listPingTasks,
  listUptimeChecks,
  listUsers,
  mapAdminNode,
  putSettings,
  rotateNodeToken,
  updateNode,
  updatePingTask,
  updateUptimeMonitor,
  updateUserPassword,
  writeAudit,
} from '../db';
import { sendTelegramMessage, telegramConfigured, testMessage } from '../notify';
import type { AppEnv, SessionUser, UptimeMonitorSummary } from '../types';
import { normalizeMonitorUrl, probeUrl, recordUptimeResult } from '../uptime';
import {
  badRequest,
  bool,
  clampInt,
  err,
  forbidden,
  json,
  notFound,
  nowSec,
  ok,
  parseTags,
  readJsonBody,
  str,
  unauthorized,
} from '../util';

// ── audit helper ────────────────────────────────────────────────────────────

/** Record a mutating admin action. Never fails the request. */
async function audit(
  c: { env: AppEnv['Bindings']; req: { raw: Request }; get: (k: 'user') => SessionUser | null },
  action: string,
  target = '',
  detail = '',
): Promise<void> {
  try {
    const user = c.get('user');
    await writeAudit(c.env.DB, {
      user: user?.username ?? '',
      action,
      target,
      detail,
      ip: clientIp(c.req.raw),
    });
  } catch {
    // Audit failures must not break the API call.
  }
}

// ── /api/auth (§4.3) ────────────────────────────────────────────────────────

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', async (c) => {
  const db = c.env.DB;
  const ip = clientIp(c.req.raw);

  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return err(c, 429, 'rate_limited', 'Too many login attempts', { 'retry-after': String(limit.retryAfter) });
  }

  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  const username = str(body.username).trim();
  const password = str(body.password);
  if (username === '' || password === '') {
    return badRequest(c, '`username` and `password` are required');
  }

  const iterations = iterationsFromEnv(c.env);

  // ── bootstrap: the very first login creates the admin (§4.3) ─────────────
  if ((await countUsers(db)) === 0) {
    if (username !== 'admin' || password !== bootstrapPassword(c.env)) {
      return unauthorized(c, 'Invalid username or password');
    }
    const user = await createUser(db, 'admin', await hashPassword(password, iterations), 'admin');
    const session = await issueSession(db, user.id);
    setSessionCookie(c, session.id);
    resetLoginRateLimit(ip);
    await writeAudit(db, { user: 'admin', action: 'bootstrap', target: 'admin', ip });
    return ok(c, { user: toSessionUser(user), bootstrap: true });
  }

  const user = await getUserByUsername(db, username);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return unauthorized(c, 'Invalid username or password');
  }

  const session = await issueSession(db, user.id);
  setSessionCookie(c, session.id);
  resetLoginRateLimit(ip);
  return ok(c, { user: toSessionUser(user) });
});

authRoutes.post('/logout', async (c) => {
  await logoutSession(c);
  return ok(c);
});

authRoutes.get('/me', optionalAuth, async (c) => {
  const user = c.get('user');
  if (!user) return unauthorized(c);
  return json(c, { user });
});

authRoutes.post('/password', requireAuth, async (c) => {
  const db = c.env.DB;
  const actor = currentUser(c);
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  const oldPassword = str(body.old_password);
  const newPassword = str(body.new_password);
  if (oldPassword === '' || newPassword === '') {
    return badRequest(c, '`old_password` and `new_password` are required');
  }
  const user = await getUserById(db, actor.id);
  if (!user || !(await verifyPassword(oldPassword, user.password_hash))) {
    return unauthorized(c, 'Current password is incorrect');
  }
  await updateUserPassword(db, user.id, await hashPassword(newPassword, iterationsFromEnv(c.env)));
  await audit(c, 'user.password', user.username);
  return ok(c);
});

// ── /api/admin (§4.4) ───────────────────────────────────────────────────────

export const adminRoutes = new Hono<AppEnv>();

// All admin routes require auth (contract item 8: no exceptions).
adminRoutes.use('*', requireAuth);

/**
 * Role gate for everything that mutates state.
 *
 * `requireAuth` alone would let a `viewer` account create nodes, rotate agent
 * tokens, rewrite settings and add users — the role column would be decorative.
 * Only mutating methods are gated, so a viewer can still read the panel.
 */
const MUTATING: string[] = ['POST', 'PATCH', 'PUT', 'DELETE'];
for (const path of ['/nodes', '/nodes/*', '/pings', '/pings/*', '/uptime', '/uptime/*', '/settings', '/settings/*', '/users', '/users/*', '/notify', '/notify/*']) {
  adminRoutes.on(MUTATING, path, requireAdmin());
}
adminRoutes.on(MUTATING, '/sweep', requireAdmin());

// ── nodes ───────────────────────────────────────────────────────────────────

adminRoutes.get('/nodes', async (c) => {
  const now = nowSec();
  const settings = await getSettings(c.env.DB);
  const rows = await listNodes(c.env.DB, true);
  return json(c, { nodes: rows.map((row) => mapAdminNode(row, settings.offline_after, now)) });
});

adminRoutes.post('/nodes', async (c) => {
  const db = c.env.DB;
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');

  const name = str(body.name).trim();
  if (name === '') return badRequest(c, '`name` is required');
  if (await getNodeByName(db, name)) {
    return err(c, 409, 'conflict', `A node named "${name}" already exists`);
  }

  const issued = await issueAgentToken();
  const node = await createNode(db, {
    name,
    tokenHash: issued.tokenHash,
    tokenHint: issued.tokenHint,
    group: str(body.group, 'default') || 'default',
    region: str(body.region),
    tags: parseTags(body.tags),
    hidden: bool(body.hidden),
    sortOrder: Math.trunc(clampInt(body.sort_order, -1_000_000, 1_000_000, 0)),
    price: str(body.price),
    trafficGb: clampInt(body.traffic_gb, 0, 1_000_000, 0),
    trafficBoth: 'traffic_both' in body ? bool(body.traffic_both, true) : true,
    expiresAt: str(body.expires_at),
    notify: 'notify' in body ? bool(body.notify, true) : true,
  });

  await audit(c, 'node.create', node.id, name);
  const settings = await getSettings(db);
  return ok(c, { node: mapAdminNode(node, settings.offline_after, nowSec()), token: issued.token });
});

adminRoutes.patch('/nodes/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');

  const existing = await getNode(db, id);
  if (!existing) return notFound(c, 'Node not found');

  if ('name' in body) {
    const name = str(body.name).trim();
    if (name === '') return badRequest(c, '`name` cannot be empty');
    const clash = await getNodeByName(db, name);
    if (clash && clash.id !== id) {
      return err(c, 409, 'conflict', `A node named "${name}" already exists`);
    }
  }

  const node = await updateNode(db, id, body);
  if (!node) return notFound(c, 'Node not found');
  await audit(c, 'node.update', id, JSON.stringify(Object.keys(body)));
  const settings = await getSettings(db);
  return ok(c, { node: mapAdminNode(node, settings.offline_after, nowSec()) });
});

adminRoutes.delete('/nodes/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await getNode(db, id);
  if (!existing) return notFound(c, 'Node not found');
  await deleteNode(db, id);
  await audit(c, 'node.delete', id, existing.name);
  return ok(c, { node_id: id });
});

adminRoutes.post('/nodes/:id/token', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await getNode(db, id);
  if (!existing) return notFound(c, 'Node not found');
  const issued = await issueAgentToken();
  await rotateNodeToken(db, id, issued.tokenHash, issued.tokenHint);
  await audit(c, 'node.token.rotate', id, existing.name);
  return ok(c, { token: issued.token, token_hint: issued.tokenHint });
});

// ── ping tasks ──────────────────────────────────────────────────────────────

adminRoutes.get('/pings', async (c) => {
  const nodeId = c.req.query('node_id');
  const rows = await listPingTasks(c.env.DB, nodeId || undefined);
  return json(c, {
    pings: rows.map((row) => ({
      id: row.id,
      node_id: row.node_id,
      name: row.name,
      type: row.type,
      target: row.target,
      interval: row.interval,
      enabled: bool(row.enabled, true),
    })),
  });
});

adminRoutes.post('/pings', async (c) => {
  const db = c.env.DB;
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  const nodeId = str(body.node_id).trim();
  const name = str(body.name).trim();
  const target = str(body.target).trim();
  if (nodeId === '' || name === '' || target === '') {
    return badRequest(c, '`node_id`, `name` and `target` are required');
  }
  if (!(await getNode(db, nodeId))) return notFound(c, 'Node not found');
  const task = await createPingTask(db, {
    node_id: nodeId,
    name,
    type: str(body.type, 'tcp'),
    target,
    interval: clampInt(body.interval, 1, 86400, 60),
    enabled: 'enabled' in body ? bool(body.enabled, true) : true,
  });
  await audit(c, 'ping.create', task.id, `${name} → ${target}`);
  return ok(c, { ping: { ...task, enabled: bool(task.enabled, true) } });
});

adminRoutes.patch('/pings/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  if (!(await getPingTask(db, id))) return notFound(c, 'Ping task not found');
  const task = await updatePingTask(db, id, body);
  if (!task) return notFound(c, 'Ping task not found');
  await audit(c, 'ping.update', id, JSON.stringify(Object.keys(body)));
  return ok(c, { ping: { ...task, enabled: bool(task.enabled, true) } });
});

adminRoutes.delete('/pings/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await getPingTask(db, id);
  if (!existing) return notFound(c, 'Ping task not found');
  await deletePingTask(db, id);
  await audit(c, 'ping.delete', id, existing.name);
  return ok(c, { ping_id: id });
});

// ── uptime monitors ─────────────────────────────────────────────────────────

/** Re-read one monitor as a summary, so responses carry live uptime figures. */
async function uptimeSummary(
  db: D1Database,
  id: string,
  now: number,
): Promise<UptimeMonitorSummary | null> {
  const monitors = await getUptimeSummaries(db, now, true);
  return monitors.find((monitor) => monitor.id === id) ?? null;
}

adminRoutes.get('/uptime', async (c) => {
  const monitors = await getUptimeSummaries(c.env.DB, nowSec(), true);
  return json(c, { monitors });
});

/**
 * Probe a URL without saving anything.
 *
 * This is what makes adding a monitor painless: the form posts the URL as you
 * type, gets the real status code back, and offers it as the expected status.
 * No audit row — this is a read-only probe and auditing it would flood the log
 * with one entry per keystroke.
 */
adminRoutes.post('/uptime/check', async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  const url = normalizeMonitorUrl(body.url);
  if (url === null) return badRequest(c, '`url` must be a public http(s) URL');
  const result = await probeUrl(url, {
    method: body.method,
    expected: body.expected_status,
    timeoutMs: body.timeout_ms,
  });
  return json(c, { result });
});

adminRoutes.post('/uptime', async (c) => {
  const db = c.env.DB;
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');

  const url = normalizeMonitorUrl(body.url);
  if (url === null) return badRequest(c, '`url` must be a public http(s) URL');

  const monitor = await createUptimeMonitor(db, {
    name: str(body.name),
    url,
    method: body.method,
    interval: body.interval,
    expectedStatus: body.expected_status,
    timeoutMs: body.timeout_ms,
    enabled: 'enabled' in body ? bool(body.enabled, true) : true,
  });

  // Probe once immediately so the list shows a real status instead of "pending".
  const result = await probeUrl(monitor.url, {
    method: monitor.method,
    expected: monitor.expected_status,
    timeoutMs: monitor.timeout_ms,
  });
  const ts = nowSec();
  await recordUptimeResult(db, monitor.id, result, ts);

  await audit(c, 'uptime.create', monitor.id, `${monitor.name} → ${monitor.url}`);
  return ok(c, { monitor: await uptimeSummary(db, monitor.id, ts), result });
});

adminRoutes.get('/uptime/:id', async (c) => {
  const id = c.req.param('id');
  const now = nowSec();
  const monitors = await getUptimeSummaries(c.env.DB, now, true);
  const monitor = monitors.find((row) => row.id === id);
  if (!monitor) return notFound(c, 'Uptime monitor not found');
  const limit = clampInt(c.req.query('limit'), 1, 500, 60);
  const checks = await listUptimeChecks(c.env.DB, id, limit);
  return json(c, { monitor, checks });
});

adminRoutes.patch('/uptime/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  if (!(await getUptimeMonitor(db, id))) return notFound(c, 'Uptime monitor not found');
  if ('url' in body && normalizeMonitorUrl(body.url) === null) {
    return badRequest(c, '`url` must be a public http(s) URL');
  }

  const monitor = await updateUptimeMonitor(db, id, body);
  if (!monitor) return notFound(c, 'Uptime monitor not found');

  // Re-probe when the target or the pass/fail rule changed; otherwise the row
  // would keep a verdict computed against the previous settings.
  const recheck = 'url' in body || 'method' in body || 'expected_status' in body;
  const ts = nowSec();
  if (recheck) {
    const result = await probeUrl(monitor.url, {
      method: monitor.method,
      expected: monitor.expected_status,
      timeoutMs: monitor.timeout_ms,
    });
    await recordUptimeResult(db, id, result, ts);
  }

  await audit(c, 'uptime.update', id, JSON.stringify(Object.keys(body)));
  return ok(c, { monitor: await uptimeSummary(db, id, ts) });
});

adminRoutes.post('/uptime/:id/check', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const monitor = await getUptimeMonitor(db, id);
  if (!monitor) return notFound(c, 'Uptime monitor not found');
  const result = await probeUrl(monitor.url, {
    method: monitor.method,
    expected: monitor.expected_status,
    timeoutMs: monitor.timeout_ms,
  });
  const ts = nowSec();
  await recordUptimeResult(db, id, result, ts);
  await audit(c, 'uptime.check', id, monitor.name);
  return ok(c, { monitor: await uptimeSummary(db, id, ts), result });
});

adminRoutes.delete('/uptime/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await getUptimeMonitor(db, id);
  if (!existing) return notFound(c, 'Uptime monitor not found');
  await deleteUptimeMonitor(db, id);
  await audit(c, 'uptime.delete', id, existing.name);
  return ok(c, { monitor_id: id });
});

// ── settings ────────────────────────────────────────────────────────────────

adminRoutes.get('/settings', async (c) => {
  return json(c, { settings: await getSettings(c.env.DB) });
});

adminRoutes.put('/settings', async (c) => {
  const db = c.env.DB;
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  // Unknown keys are ignored on write (§2.1).
  const settings = await putSettings(db, body);
  await audit(c, 'settings.update', '', JSON.stringify(Object.keys(body)));
  return ok(c, { settings });
});

// ── users ───────────────────────────────────────────────────────────────────

adminRoutes.get('/users', async (c) => {
  const rows = await listUsers(c.env.DB);
  return json(c, { users: rows.map((row) => ({ id: row.id, username: row.username, role: row.role, created_at: row.created_at })) });
});

adminRoutes.post('/users', async (c) => {
  const db = c.env.DB;
  const body = await readJsonBody(c.req.raw);
  if (!body) return badRequest(c, 'Request body must be a JSON object');
  const username = str(body.username).trim();
  const password = str(body.password);
  const role = str(body.role, 'admin') === 'viewer' ? 'viewer' : 'admin';
  if (username === '' || password === '') return badRequest(c, '`username` and `password` are required');
  if (await getUserByUsername(db, username)) {
    return err(c, 409, 'conflict', `User "${username}" already exists`);
  }
  const user = await createUser(db, username, await hashPassword(password, iterationsFromEnv(c.env)), role);
  await audit(c, 'user.create', user.id, username);
  return ok(c, { user: { id: user.id, username: user.username, role: user.role, created_at: user.created_at } });
});

adminRoutes.delete('/users/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const actor = currentUser(c);
  const target = await getUserById(db, id);
  if (!target) return notFound(c, 'User not found');
  if (target.id === actor.id) return forbidden(c, 'You cannot delete your own account');
  if (target.role === 'admin' && (await countAdmins(db)) <= 1) {
    return forbidden(c, 'Cannot delete the last admin');
  }
  await deleteUser(db, id);
  await audit(c, 'user.delete', id, target.username);
  return ok(c, { user_id: id });
});

// ── audit log ───────────────────────────────────────────────────────────────

adminRoutes.get('/audit', async (c) => {
  const limit = clampInt(c.req.query('limit'), 1, 1000, 100);
  return json(c, { audit: await listAudit(c.env.DB, limit) });
});

// ── overview ────────────────────────────────────────────────────────────────

adminRoutes.get('/overview', async (c) => {
  const now = nowSec();
  const settings = await getSettings(c.env.DB);
  return json(c, await getOverview(c.env.DB, settings, now));
});

// ── notifications ───────────────────────────────────────────────────────────

/**
 * Deliver a test message through the configured Telegram bot.
 *
 * 400 when Telegram is unconfigured, 502 when the API rejects the message or
 * cannot be reached — the response is what the settings page surfaces, so
 * failures must be loud here rather than silently logged.
 */
adminRoutes.post('/notify/test', async (c) => {
  const settings = await getSettings(c.env.DB);
  if (!telegramConfigured(settings)) {
    return badRequest(c, 'Telegram is not configured: set `tg_bot_token` and `tg_chat_id` first');
  }
  const sent = await sendTelegramMessage(settings, testMessage(settings));
  await audit(c, 'notify.test', '', sent ? 'sent' : 'failed');
  if (!sent) {
    return err(c, 502, 'telegram_error', 'Telegram API rejected the message or was unreachable; check the bot token and chat id');
  }
  return ok(c, { sent: true });
});

// ── manual sweep (testing / ops) ────────────────────────────────────────────

adminRoutes.post('/sweep', async (c) => {
  const counts = await runSweep(c.env);
  await audit(c, 'sweep', '', JSON.stringify(counts));
  return ok(c, counts);
});
