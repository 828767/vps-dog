/**
 * Hono app assembly: CORS, error handling, API mounting and the SPA asset
 * fallback (§4.5, §5).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getSettings } from './db';
import { agentRoutes } from './routes/agent';
import { adminRoutes, authRoutes } from './routes/admin';
import { publicRoutes } from './routes/public';
import type { AppEnv } from './types';
import { err, json, notFound } from './util';

// ── CORS (§5) ───────────────────────────────────────────────────────────────

const CORS_ALLOW_HEADERS = 'content-type, authorization, x-node-token';
const CORS_ALLOW_METHODS = 'GET,POST,PATCH,PUT,DELETE,OPTIONS';

/**
 * CORS headers for a request.
 *
 * §5 says to use the request `Origin`, else `*`, and to send
 * `Access-Control-Allow-Credentials: true`. Those two are mutually exclusive in
 * the CORS spec: a wildcard origin cannot be combined with credentials. So a
 * concrete `Origin` is echoed with `Allow-Credentials: true`, and a request
 * without an `Origin` (i.e. not a browser cross-origin call) gets `*` with no
 * credentials header. Browsers never see the second case.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && origin !== '') {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': CORS_ALLOW_HEADERS,
      'access-control-allow-methods': CORS_ALLOW_METHODS,
      'access-control-expose-headers': 'content-type',
      vary: 'Origin',
    };
  }
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': CORS_ALLOW_HEADERS,
    'access-control-allow-methods': CORS_ALLOW_METHODS,
  };
}

// ── app ─────────────────────────────────────────────────────────────────────

export const app = new Hono<AppEnv>();

/** Echo CORS headers on every `/api/*` response. */
app.use('/api/*', async (c, next) => {
  await next();
  for (const [key, value] of Object.entries(corsHeaders(c.req.raw))) {
    c.res.headers.set(key, value);
  }
  c.res.headers.set('x-content-type-options', 'nosniff');
});

/** Preflight. */
app.options('/api/*', (c) => {
  return new Response(null, { status: 204, headers: corsHeaders(c.req.raw) });
});

// ── API surface ─────────────────────────────────────────────────────────────

app.route('/api/v1', agentRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', publicRoutes);

/** Unknown `/api/*` paths are JSON 404s, never the SPA shell. */
app.all('/api/*', (c) => notFound(c, 'Unknown API endpoint'));

// ── static assets / SPA fallback (§4.5) ─────────────────────────────────────

const NO_BUILD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VPS-DOG — frontend not built</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #0b0f14; color: #e6edf3;
         font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { color: #8b98a5; margin: 0 0 1rem; }
  code { background: #131a22; border: 1px solid #1f2a36; border-radius: .5rem;
         padding: .15rem .45rem; color: #3b82f6; }
  pre { background: #131a22; border: 1px solid #1f2a36; border-radius: 1rem; padding: 1rem; overflow-x: auto; }
</style>
</head>
<body>
<main>
  <h1>The VPS-DOG frontend has not been built yet</h1>
  <p>The Worker is running and the API is live under <code>/api</code>, but the
     static assets binding is empty. Build the SPA and reload:</p>
  <pre>pnpm build</pre>
  <p>Then try <code>GET /api/status</code>.</p>
</main>
</body>
</html>
`;

/** Any non-API GET falls through to the asset binding. */
app.get('*', async (c: Context<AppEnv>) => {
  const assets = c.env.ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    try {
      const res = await assets.fetch(c.req.raw);
      // `custom_head` (§2.1) is raw HTML injected before `</head>` on the SPA
      // shell only. It is an admin-only setting and is deliberately NOT escaped
      // — that is the documented contract. It is never applied to API
      // responses, and `run_worker_first` keeps `/api/*` away from this path.
      if (res.headers.get('content-type')?.includes('text/html')) {
        const settings = await getSettings(c.env.DB);
        if (settings.custom_head.trim() !== '') {
          const html = await res.text();
          const injected = html.replace(/<\/head>/i, `${settings.custom_head}\n</head>`);
          return new Response(injected === html ? html : injected, {
            status: res.status,
            headers: res.headers,
          });
        }
      }
      return res;
    } catch {
      // Fall through to the friendly page rather than surfacing a 500.
    }
  }
  return c.newResponse(NO_BUILD_HTML, 200, {
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
});

// ── errors ──────────────────────────────────────────────────────────────────

app.notFound((c) => notFound(c, 'Not found'));

app.onError((e, c) => {
  // Never leak stack traces or internals to clients.
  const isApi = new URL(c.req.url).pathname.startsWith('/api');
  console.error('[vps-dog] unhandled error:', e instanceof Error ? e.message : String(e));
  if (isApi) {
    return err(c, 500, 'internal_error', 'Internal server error');
  }
  return json(c, { error: 'internal_error', message: 'Internal server error' }, 500);
});
