import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, qk } from './api';
import type {
  GroupsResponse,
  MetricSeries,
  NodeDetail,
  NodePingsResponse,
  NodesResponse,
  PublicStatus,
  UptimeBoard,
  UptimeDetailResponse,
} from './types';

/** Dashboard / node-detail auto-refresh cadence (§7). */
export const LIVE_INTERVAL_MS = 10_000;

/** Shared options: poll forever, keep the last good data while refetching. */
const liveOptions = {
  refetchInterval: LIVE_INTERVAL_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 5_000,
  retry: 1,
} as const;

/** `GET /api/status` — polled every 10 s. */
export function useStatusLive(): UseQueryResult<PublicStatus, Error> {
  return useQuery<PublicStatus, Error>({
    queryKey: qk.status,
    queryFn: ({ signal }) => api.status(signal),
    ...liveOptions,
  });
}

/** `GET /api/nodes` — polled every 10 s; drives the dashboard grid. */
export function useNodesLive(): UseQueryResult<NodesResponse, Error> {
  return useQuery<NodesResponse, Error>({
    queryKey: qk.nodes,
    queryFn: ({ signal }) => api.nodes(signal),
    ...liveOptions,
  });
}

/** `GET /api/nodes/:id` — polled every 10 s. */
export function useNodeLive(id: string | undefined): UseQueryResult<NodeDetail, Error> {
  return useQuery<NodeDetail, Error>({
    queryKey: qk.node(id ?? ''),
    queryFn: ({ signal }) => api.node(id as string, signal),
    enabled: typeof id === 'string' && id.length > 0,
    ...liveOptions,
  });
}

/** `GET /api/nodes/:id/metrics?hours=` — refetched whenever `hours` changes. */
export function useNodeMetrics(
  id: string | undefined,
  hours: number,
): UseQueryResult<MetricSeries, Error> {
  return useQuery<MetricSeries, Error>({
    queryKey: qk.metrics(id ?? '', hours),
    queryFn: ({ signal }) => api.metrics(id as string, hours, signal),
    enabled: typeof id === 'string' && id.length > 0,
    ...liveOptions,
    // History is bucketed worker-side; a full 10 s poll is plenty.
    staleTime: 5_000,
  });
}

/** `GET /api/nodes/:id/pings` — polled every 10 s. */
export function useNodePings(id: string | undefined): UseQueryResult<NodePingsResponse, Error> {
  return useQuery<NodePingsResponse, Error>({
    queryKey: qk.nodePings(id ?? ''),
    queryFn: ({ signal }) => api.nodePings(id as string, signal),
    enabled: typeof id === 'string' && id.length > 0,
    ...liveOptions,
  });
}

/** `GET /api/groups` — changes rarely, so it is not polled aggressively. */
export function useGroups(): UseQueryResult<GroupsResponse, Error> {
  return useQuery<GroupsResponse, Error>({
    queryKey: qk.groups,
    queryFn: ({ signal }) => api.groups(signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

/** `GET /api/uptime` — website availability board, polled every 10 s. */
export function useUptimeLive(): UseQueryResult<UptimeBoard, Error> {
  return useQuery<UptimeBoard, Error>({
    queryKey: qk.uptime,
    queryFn: ({ signal }) => api.uptime(signal),
    ...liveOptions,
  });
}

/** `GET /api/uptime/:id` — one monitor with its recent checks, polled every 10 s. */
export function useUptimeDetail(
  id: string | undefined,
  limit = 200,
): UseQueryResult<UptimeDetailResponse, Error> {
  return useQuery<UptimeDetailResponse, Error>({
    queryKey: qk.uptimeDetail(id ?? ''),
    queryFn: ({ signal }) => api.uptimeDetail(id as string, limit, signal),
    enabled: typeof id === 'string' && id.length > 0,
    ...liveOptions,
  });
}

/** Ticking clock so “12s ago” labels stay honest without a refetch. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
