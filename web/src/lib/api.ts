import type {
  AdminNodesResponse,
  AdminOverview,
  AdminPingTask,
  AdminPingsResponse,
  AdminUptimeDetailResponse,
  AdminUptimeResponse,
  AdminUsersResponse,
  AuditResponse,
  CreateNodeInput,
  CreateNodeResponse,
  GroupsResponse,
  LoginResponse,
  MeResponse,
  MetricSeries,
  NodeDetail,
  NodePingsResponse,
  NodesResponse,
  OkResponse,
  PingTaskInput,
  PingTaskPatch,
  PublicStatus,
  RotateTokenResponse,
  Settings,
  UpdateNodeInput,
  UptimeBoard,
  UptimeDetailResponse,
  UptimeMonitor,
  UptimeMonitorInput,
  UptimeProbeResult,
  User,
  UserRole,
} from './types';

/** Every request goes to a relative `/api/...` path so the SPA works from the
 *  Worker's static-asset binding and from the Vite dev proxy alike. */
export const API_BASE = '/api';

/** Error thrown for any non-2xx API response, carrying the contract's
 *  `{ error, message }` envelope plus the HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message && message.length > 0 ? message : code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** 401 / 403 — the caller should bounce to the login screen. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${url}?${qs}` : url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      // Session lives in the HttpOnly `vpsdog_session` cookie.
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network_error', 'Network request failed');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const code = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : 'http_error';
    const message = isRecord(parsed) && typeof parsed.message === 'string' ? parsed.message : undefined;
    throw new ApiError(response.status, code, message);
  }

  return parsed as T;
}

/* ── §4.2 public read API (no auth) ───────────────────────────────────────── */

export const api = {
  /** `GET /api/status` */
  status(signal?: AbortSignal): Promise<PublicStatus> {
    return request<PublicStatus>('/status', { signal });
  },

  /** `GET /api/nodes` */
  nodes(signal?: AbortSignal): Promise<NodesResponse> {
    return request<NodesResponse>('/nodes', { signal });
  },

  /** `GET /api/nodes/:id` */
  node(id: string, signal?: AbortSignal): Promise<NodeDetail> {
    return request<NodeDetail>(`/nodes/${encodeURIComponent(id)}`, { signal });
  },

  /** `GET /api/nodes/:id/metrics?hours=1` (1..168) */
  metrics(id: string, hours: number, signal?: AbortSignal): Promise<MetricSeries> {
    return request<MetricSeries>(`/nodes/${encodeURIComponent(id)}/metrics`, {
      query: { hours },
      signal,
    });
  },

  /** `GET /api/nodes/:id/pings` */
  nodePings(id: string, signal?: AbortSignal): Promise<NodePingsResponse> {
    return request<NodePingsResponse>(`/nodes/${encodeURIComponent(id)}/pings`, { signal });
  },

  /** `GET /api/groups` */
  groups(signal?: AbortSignal): Promise<GroupsResponse> {
    return request<GroupsResponse>('/groups', { signal });
  },

  /** `GET /api/uptime` — the public availability board. */
  uptime(signal?: AbortSignal): Promise<UptimeBoard> {
    return request<UptimeBoard>('/uptime', { signal });
  },

  /** `GET /api/uptime/:id` — one monitor plus its recent checks. */
  uptimeDetail(id: string, limit = 200, signal?: AbortSignal): Promise<UptimeDetailResponse> {
    return request<UptimeDetailResponse>(`/uptime/${encodeURIComponent(id)}`, {
      query: { limit },
      signal,
    });
  },
};

/* ── §4.3 auth API ────────────────────────────────────────────────────────── */

export const authApi = {
  /** `POST /api/auth/login` — sets the `vpsdog_session` cookie. */
  login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/auth/login', { method: 'POST', body: { username, password } });
  },

  /** `POST /api/auth/logout` */
  logout(): Promise<OkResponse> {
    return request<OkResponse>('/auth/logout', { method: 'POST' });
  },

  /** `GET /api/auth/me` — 401 when there is no valid session. */
  me(signal?: AbortSignal): Promise<MeResponse> {
    return request<MeResponse>('/auth/me', { signal });
  },

  /** `POST /api/auth/password` */
  changePassword(oldPassword: string, newPassword: string): Promise<OkResponse> {
    return request<OkResponse>('/auth/password', {
      method: 'POST',
      body: { old_password: oldPassword, new_password: newPassword },
    });
  },
};

/* ── §4.4 admin API ───────────────────────────────────────────────────────── */

export const adminApi = {
  /** `GET /api/admin/overview` */
  overview(signal?: AbortSignal): Promise<AdminOverview> {
    return request<AdminOverview>('/admin/overview', { signal });
  },

  /* nodes */
  listNodes(signal?: AbortSignal): Promise<AdminNodesResponse> {
    return request<AdminNodesResponse>('/admin/nodes', { signal });
  },
  createNode(input: CreateNodeInput): Promise<CreateNodeResponse> {
    return request<CreateNodeResponse>('/admin/nodes', { method: 'POST', body: input });
  },
  updateNode(id: string, input: UpdateNodeInput): Promise<OkResponse> {
    return request<OkResponse>(`/admin/nodes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    });
  },
  deleteNode(id: string): Promise<OkResponse> {
    return request<OkResponse>(`/admin/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  rotateToken(id: string): Promise<RotateTokenResponse> {
    return request<RotateTokenResponse>(`/admin/nodes/${encodeURIComponent(id)}/token`, {
      method: 'POST',
    });
  },

  /* ping tasks */
  listPings(nodeId?: string, signal?: AbortSignal): Promise<AdminPingsResponse> {
    return request<AdminPingsResponse>('/admin/pings', { query: { node_id: nodeId }, signal });
  },
  createPing(input: PingTaskInput): Promise<OkResponse & { ping?: AdminPingTask }> {
    return request<OkResponse & { ping?: AdminPingTask }>('/admin/pings', {
      method: 'POST',
      body: input,
    });
  },
  updatePing(id: string, patch: PingTaskPatch): Promise<OkResponse> {
    return request<OkResponse>(`/admin/pings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    });
  },
  deletePing(id: string): Promise<OkResponse> {
    return request<OkResponse>(`/admin/pings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* uptime monitors */
  listUptime(signal?: AbortSignal): Promise<AdminUptimeResponse> {
    return request<AdminUptimeResponse>('/admin/uptime', { signal });
  },
  /** Probe a URL without saving it — powers the auto-detected status code. */
  probeUptime(
    url: string,
    options: { method?: string; expected_status?: string; timeout_ms?: number } = {},
  ): Promise<{ ok: true; result: UptimeProbeResult }> {
    return request<{ ok: true; result: UptimeProbeResult }>('/admin/uptime/check', {
      method: 'POST',
      body: { url, ...options },
    });
  },
  getUptime(id: string, limit = 60, signal?: AbortSignal): Promise<AdminUptimeDetailResponse> {
    return request<AdminUptimeDetailResponse>(`/admin/uptime/${encodeURIComponent(id)}`, {
      query: { limit },
      signal,
    });
  },
  createUptime(
    input: UptimeMonitorInput,
  ): Promise<OkResponse & { monitor?: UptimeMonitor; result?: UptimeProbeResult }> {
    return request<OkResponse & { monitor?: UptimeMonitor; result?: UptimeProbeResult }>(
      '/admin/uptime',
      { method: 'POST', body: input },
    );
  },
  updateUptime(
    id: string,
    patch: Partial<UptimeMonitorInput>,
  ): Promise<OkResponse & { monitor?: UptimeMonitor }> {
    return request<OkResponse & { monitor?: UptimeMonitor }>(
      `/admin/uptime/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: patch },
    );
  },
  checkUptime(
    id: string,
  ): Promise<OkResponse & { monitor?: UptimeMonitor; result?: UptimeProbeResult }> {
    return request<OkResponse & { monitor?: UptimeMonitor; result?: UptimeProbeResult }>(
      `/admin/uptime/${encodeURIComponent(id)}/check`,
      { method: 'POST' },
    );
  },
  deleteUptime(id: string): Promise<OkResponse> {
    return request<OkResponse>(`/admin/uptime/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* settings */
  getSettings(signal?: AbortSignal): Promise<Settings> {    // The worker wraps the payload in `{ settings }` — unwrap it here so the
    // page sees the bare Settings object its type promises.
    return request<{ settings: Settings }>('/admin/settings', { signal }).then(
      (body) => body.settings,
    );
  },
  updateSettings(patch: Partial<Settings>): Promise<OkResponse> {
    return request<OkResponse>('/admin/settings', { method: 'PUT', body: patch });
  },

  /* notifications */
  /** `POST /api/admin/notify/test` — send a test message via the Telegram bot. */
  sendTelegramTest(): Promise<OkResponse & { sent: boolean }> {
    return request<OkResponse & { sent: boolean }>('/admin/notify/test', { method: 'POST' });
  },

  /* users */
  listUsers(signal?: AbortSignal): Promise<AdminUsersResponse> {
    return request<AdminUsersResponse>('/admin/users', { signal });
  },
  createUser(username: string, password: string, role: UserRole): Promise<OkResponse & { user?: User }> {
    return request<OkResponse & { user?: User }>('/admin/users', {
      method: 'POST',
      body: { username, password, role },
    });
  },
  deleteUser(id: string): Promise<OkResponse> {
    return request<OkResponse>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* audit */
  audit(limit = 100, signal?: AbortSignal): Promise<AuditResponse> {
    return request<AuditResponse>('/admin/audit', { query: { limit }, signal });
  },
};

/** Human-readable message for any thrown value, without leaking `any`. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Stable query key factory — keeps cache invalidation honest. */
export const qk = {
  status: ['status'] as const,
  nodes: ['nodes'] as const,
  node: (id: string) => ['node', id] as const,
  metrics: (id: string, hours: number) => ['node', id, 'metrics', hours] as const,
  nodePings: (id: string) => ['node', id, 'pings'] as const,
  groups: ['groups'] as const,
  uptime: ['uptime'] as const,
  uptimeDetail: (id: string) => ['uptime', id] as const,
  me: ['auth', 'me'] as const,
  adminOverview: ['admin', 'overview'] as const,
  adminNodes: ['admin', 'nodes'] as const,
  adminPings: (nodeId?: string) => ['admin', 'pings', nodeId ?? 'all'] as const,
  adminUptime: ['admin', 'uptime'] as const,
  adminUptimeDetail: (id: string) => ['admin', 'uptime', id] as const,
  adminSettings: ['admin', 'settings'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminAudit: (limit: number) => ['admin', 'audit', limit] as const,
};
