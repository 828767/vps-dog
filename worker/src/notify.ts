/**
 * Telegram notifications: the outbound sender plus the offline/recovery
 * scanner that the cron trigger runs after the retention sweep.
 *
 * The scanner compares each node's derived online state (`isOnline()`, i.e.
 * computed from `last_seen`) with what the notifier last *told the admin*
 * (`nodes.notified_offline`) and messages the configured chat on transitions:
 *
 *   offline pending  = last_seen > 0 AND offline AND notified_offline = 0
 *   recovery pending = online AND notified_offline = 1
 *
 * `notified_offline` is deliberately not a copy of the online flag (§7 keeps
 * that derived at read time, never stored as truth): it is send-state for the
 * notifier, so each outage produces exactly one message and each recovery
 * exactly one even though the scanner re-evaluates every node on every tick.
 * A failed send leaves the flag untouched, so the next tick retries.
 */
import { getSettings, isOnline } from './db';
import type { Env, NotifyScanCounts, Settings, UptimeNotifyCounts } from './types';
import { nowSec } from './util';

/** True when both halves of the Telegram config are present. */
export function telegramConfigured(settings: Settings): boolean {
  return settings.tg_bot_token !== '' && settings.tg_chat_id !== '';
}

/** Escape user-controlled text (node names come from admins) for HTML mode. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** `3600` → `1 小时 0 分钟` style coarse age, for "last seen" lines. */
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

interface AlertNode {
  name: string;
  group_name: string;
  ip: string;
  last_seen: number;
}

function offlineMessage(node: AlertNode, settings: Settings, now: number): string {
  const site = escapeHtml(settings.site_name);
  const name = escapeHtml(node.name);
  const group = escapeHtml(node.group_name || 'default');
  const ip = node.ip !== '' ? escapeHtml(node.ip) : '未知';
  const age = formatAge(Math.max(0, now - node.last_seen));
  return (
    `🔴 <b>${name}</b> 离线\n` +
    `\n站点：${site}` +
    `\n分组：${group}` +
    `\nIP：${ip}` +
    `\n最后上报：${age}前`
  );
}

function recoveryMessage(node: AlertNode, settings: Settings): string {
  const site = escapeHtml(settings.site_name);
  const name = escapeHtml(node.name);
  const group = escapeHtml(node.group_name || 'default');
  const ip = node.ip !== '' ? escapeHtml(node.ip) : '未知';
  return (
    `🟢 <b>${name}</b> 恢复上线\n` +
    `\n站点：${site}` +
    `\n分组：${group}` +
    `\nIP：${ip}`
  );
}

/** Text sent by `POST /api/admin/notify/test`. */
export function testMessage(settings: Settings): string {
  const site = escapeHtml(settings.site_name);
  return `✅ 【${site}】测试消息\n\nTelegram 通知配置成功。节点离线 / 恢复时会在检测到变化后发到这里。`;
}

/**
 * Send one message. Never throws: transport or Telegram API errors are logged
 * and reported as `false` so a scan can continue with the remaining nodes.
 */
export async function sendTelegramMessage(settings: Settings, text: string): Promise<boolean> {
  const url = `https://api.telegram.org/bot${settings.tg_bot_token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.tg_chat_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    const detail = (await res.text()).slice(0, 300);
    console.error(`[vps-dog] telegram sendMessage failed (${res.status}): ${detail}`);
    return false;
  } catch (e: unknown) {
    console.error('[vps-dog] telegram sendMessage error:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

interface NotifyRow {
  id: string;
  name: string;
  group_name: string;
  ip: string;
  last_seen: number;
  notified_offline: number;
}

/**
 * Scan all nodes for offline/recovery transitions and deliver the messages.
 *
 * Called from `scheduled()` every five minutes. Cheap no-op (one settings read)
 * while Telegram is unconfigured or both event kinds are off. Nodes with
 * `notify = 0` are skipped entirely. Flags are persisted only for messages
 * that were actually delivered, so a Telegram outage never silently swallows
 * an alert — it delays it to the next tick.
 */
export async function runNotifyScan(env: Env, now = nowSec()): Promise<NotifyScanCounts> {
  const counts: NotifyScanCounts = { offline_sent: 0, online_sent: 0, send_failures: 0 };
  const settings = await getSettings(env.DB);
  if (!telegramConfigured(settings)) return counts;
  if (!settings.tg_notify_offline && !settings.tg_notify_online) return counts;

  const res = await env.DB
    .prepare('SELECT id, name, group_name, ip, last_seen, notified_offline FROM nodes WHERE notify = 1')
    .all<NotifyRow>();
  const rows = res.results ?? [];

  interface Pending {
    id: string;
    /** Value `notified_offline` should take once this item is handled. */
    flag: 0 | 1;
    /** `null` when only the flag moves (e.g. recovery notify is turned off). */
    text: string | null;
    sent: boolean;
  }
  const pending: Pending[] = [];
  for (const row of rows) {
    const online = isOnline(row, settings.offline_after, now);
    const notified = row.notified_offline === 1;
    if (!online && row.last_seen > 0 && !notified && settings.tg_notify_offline) {
      pending.push({ id: row.id, flag: 1, text: offlineMessage(row, settings, now), sent: false });
    } else if (online && notified) {
      // Reset the flag even when recovery messages are off: otherwise the
      // stale flag would suppress the next outage's offline alert.
      pending.push({
        id: row.id,
        flag: 0,
        text: settings.tg_notify_online ? recoveryMessage(row, settings) : null,
        sent: false,
      });
    }
  }

  for (const item of pending) {
    if (item.text === null) {
      item.sent = true;
      continue;
    }
    item.sent = await sendTelegramMessage(settings, item.text);
    if (!item.sent) {
      counts.send_failures++;
      continue;
    }
    if (item.flag === 1) counts.offline_sent++;
    else counts.online_sent++;
  }

  const applied = pending.filter((item) => item.sent);
  if (applied.length > 0) {
    await env.DB.batch(
      applied.map((item) =>
        env.DB.prepare('UPDATE nodes SET notified_offline = ? WHERE id = ?').bind(item.flag, item.id),
      ),
    );
  }
  return counts;
}

// ── uptime monitors ─────────────────────────────────────────────────────────

interface UptimeAlertRow {
  id: string;
  name: string;
  url: string;
  last_status: number;
  last_latency: number;
  last_ok: number;
  last_error: string;
  last_checked: number;
  notified_down: number;
}

function uptimeDownMessage(row: UptimeAlertRow, settings: Settings): string {
  const site = escapeHtml(settings.site_name);
  const name = escapeHtml(row.name);
  const url = escapeHtml(row.url);
  const reason =
    row.last_status > 0
      ? `HTTP ${row.last_status}${row.last_error !== '' ? `（${escapeHtml(row.last_error)}）` : ''}`
      : escapeHtml(row.last_error !== '' ? row.last_error : '无响应');
  return (
    `🔴 <b>${name}</b> 无法访问\n` +
    `\n站点：${site}` +
    `\n地址：${url}` +
    `\n结果：${reason}`
  );
}

function uptimeRecoveryMessage(row: UptimeAlertRow, settings: Settings): string {
  const site = escapeHtml(settings.site_name);
  const name = escapeHtml(row.name);
  const url = escapeHtml(row.url);
  return (
    `🟢 <b>${name}</b> 恢复访问\n` +
    `\n站点：${site}` +
    `\n地址：${url}` +
    `\n状态：HTTP ${row.last_status} · ${row.last_latency} ms`
  );
}

/**
 * Scan website monitors for down/recovery transitions and deliver the messages.
 *
 * Same send-state contract as the node scan: `uptime_monitors.notified_down`
 * only moves for a message that was actually delivered, so a Telegram outage
 * delays an alert instead of swallowing it. The check itself is what decides
 * up/down — this function never probes anything, it reads the last result.
 */
export async function runUptimeNotifyScan(env: Env, now = nowSec()): Promise<UptimeNotifyCounts> {
  const counts: UptimeNotifyCounts = { down_sent: 0, up_sent: 0, send_failures: 0 };
  const settings = await getSettings(env.DB);
  if (!telegramConfigured(settings) || !settings.tg_notify_uptime) return counts;

  const res = await env.DB
    .prepare(
      `SELECT id, name, url, last_status, last_latency, last_ok, last_error, last_checked, notified_down
         FROM uptime_monitors
        WHERE enabled = 1 AND last_checked > 0`,
    )
    .all<UptimeAlertRow>();
  const rows = res.results ?? [];

  interface Pending {
    id: string;
    flag: 0 | 1;
    text: string;
    sent: boolean;
  }
  const pending: Pending[] = [];
  for (const row of rows) {
    const up = row.last_ok === 1;
    if (!up && row.notified_down === 0) {
      pending.push({ id: row.id, flag: 1, text: uptimeDownMessage(row, settings), sent: false });
    } else if (up && row.notified_down === 1) {
      pending.push({ id: row.id, flag: 0, text: uptimeRecoveryMessage(row, settings), sent: false });
    }
  }

  for (const item of pending) {
    item.sent = await sendTelegramMessage(settings, item.text);
    if (!item.sent) {
      counts.send_failures++;
      continue;
    }
    if (item.flag === 1) counts.down_sent++;
    else counts.up_sent++;
  }

  const applied = pending.filter((item) => item.sent);
  if (applied.length > 0) {
    await env.DB.batch(
      applied.map((item) =>
        env.DB.prepare('UPDATE uptime_monitors SET notified_down = ? WHERE id = ?').bind(item.flag, item.id),
      ),
    );
  }
  return counts;
}
