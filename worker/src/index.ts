/**
 * Worker entry point: `fetch` (Hono) + `scheduled` (uptime checks, retention
 * sweep and Telegram notification scans).
 *
 * The cron trigger fires **every minute** so website monitors can be checked
 * at 1-minute resolution. The retention sweep and the node alert scan do not
 * need that cadence, so they are gated to every fifth tick — the same
 * five-minute beat they had before.
 */
import { runSweep } from './cron';
import { runNotifyScan, runUptimeNotifyScan } from './notify';
import { app } from './router';
import type { Env } from './types';
import { runUptimeChecks } from './uptime';
import { nowSec } from './util';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const now = nowSec();

        // ── uptime: probe, then alert on every tick ───────────────────────
        try {
          const counts = await runUptimeChecks(env, now);
          if (counts.checked > 0) {
            console.log('[vps-dog] uptime checks', JSON.stringify(counts));
          }
        } catch (e: unknown) {
          console.error('[vps-dog] uptime checks failed:', e instanceof Error ? e.message : String(e));
        }
        // Runs regardless of whether anything was probed: a message Telegram
        // rejected last tick must be retried, and that has nothing to do with
        // whether a monitor was due. Cheap no-op while unconfigured.
        try {
          const alerts = await runUptimeNotifyScan(env, now);
          if (alerts.down_sent > 0 || alerts.up_sent > 0 || alerts.send_failures > 0) {
            console.log('[vps-dog] uptime notify', JSON.stringify(alerts));
          }
        } catch (e: unknown) {
          console.error('[vps-dog] uptime notify failed:', e instanceof Error ? e.message : String(e));
        }

        // ── retention + node alerts: every five minutes ───────────────────
        if (Math.floor(now / 60) % 5 !== 0) return;

        try {
          const counts = await runSweep(env, now);
          console.log('[vps-dog] sweep complete', JSON.stringify(counts));
        } catch (e: unknown) {
          console.error('[vps-dog] sweep failed:', e instanceof Error ? e.message : String(e));
        }
        try {
          const counts = await runNotifyScan(env, now);
          // Quiet unless something actually went out or failed, to keep
          // `wrangler tail` readable on the common no-alert path.
          if (counts.offline_sent > 0 || counts.online_sent > 0 || counts.send_failures > 0) {
            console.log('[vps-dog] notify scan', JSON.stringify(counts));
          }
        } catch (e: unknown) {
          console.error('[vps-dog] notify scan failed:', e instanceof Error ? e.message : String(e));
        }
      })(),
    );
  },
};

export { app };
