import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Badge, StatusDot } from '../../components/Badge';
import { Button, IconButton } from '../../components/Button';
import { Checkbox, Input } from '../../components/Input';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { FormError } from '../../components/Notice';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { Table, type Column } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { duration, number, relativeTime } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { UptimeMethod, UptimeMonitor, UptimeProbeResult } from '../../lib/types';
import { useDebounced, useNow } from '../../lib/useLive';
import { ConfirmDialog, type ConfirmState } from './AdminDialogs';
import { useAdminAuth } from './AdminLayout';

interface MonitorFormState {
  name: string;
  url: string;
  method: UptimeMethod;
  interval: string;
  expected_status: string;
  timeout_ms: string;
  enabled: boolean;
}

const EMPTY_FORM: MonitorFormState = {
  name: '',
  url: '',
  method: 'GET',
  interval: '300',
  expected_status: '2xx',
  timeout_ms: '10000',
  enabled: true,
};

const METHOD_OPTIONS: ReadonlyArray<{ value: UptimeMethod; label: string }> = [
  { value: 'GET', label: 'GET' },
  { value: 'HEAD', label: 'HEAD' },
];

const INTERVAL_OPTIONS: ReadonlyArray<number> = [60, 120, 300, 600, 900, 1800, 3600];

/** Green when up, red when down, grey before the first check. */
function MonitorStatus({ monitor }: { monitor: UptimeMonitor }): ReactNode {
  const { t } = useI18n();
  if (monitor.last_checked === 0) {
    return <Badge tone="muted">{t('uptime.unknown')}</Badge>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot online={monitor.ok} label={monitor.ok ? t('uptime.up') : t('uptime.down')} size="sm" />
      <Badge tone={monitor.ok ? 'success' : 'danger'}>
        {monitor.ok ? t('uptime.up') : t('uptime.down')}
      </Badge>
    </span>
  );
}

/** Colour a status code by class, the way a browser's devtools would. */
function statusTone(status: number): 'success' | 'warn' | 'danger' | 'muted' {
  if (status <= 0) return 'muted';
  if (status < 300) return 'success';
  if (status < 400) return 'warn';
  return 'danger';
}

/** `-1` from the worker means "no data in this window". */
function uptimeText(value: number): string {
  return value < 0 ? '–' : `${number(value, 2)}%`;
}

/** `/admin/uptime` — website availability monitor CRUD. */
export default function AdminUptime(): ReactNode {
  const { t, lang } = useI18n();
  const { canEdit } = useAdminAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow(5_000);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UptimeMonitor | null>(null);
  const [form, setForm] = useState<MonitorFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [probe, setProbe] = useState<UptimeProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [detected, setDetected] = useState<UptimeProbeResult | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const monitorsQuery = useQuery({
    queryKey: qk.adminUptime,
    queryFn: ({ signal }) => adminApi.listUptime(signal),
    staleTime: 10_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.adminUptime });
    void queryClient.invalidateQueries({ queryKey: qk.uptime });
  };

  // ── live status detection ────────────────────────────────────────────────
  // The form probes the URL as it is typed (debounced) so the operator sees the
  // real status code before saving anything. It is a read-only probe; nothing
  // is persisted until the form is submitted.
  const debouncedUrl = useDebounced(form.url, 600);
  useEffect(() => {
    if (!formOpen) {
      setDetected(null);
      return;
    }
    const url = debouncedUrl.trim();
    if (url.length < 4 || !url.includes('.')) {
      setDetected(null);
      return;
    }
    let cancelled = false;
    setProbing(true);
    void adminApi
      .probeUptime(url, { method: form.method, timeout_ms: Number.parseInt(form.timeout_ms, 10) || undefined })
      .then((body) => {
        if (!cancelled) setDetected(body.result);
      })
      .catch(() => {
        // A probe failure is reported inline by the next render, not as a toast:
        // a URL that is still being typed fails routinely.
        if (!cancelled) setDetected(null);
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedUrl, formOpen, form.method, form.timeout_ms]);

  const createMutation = useMutation({
    mutationFn: (input: MonitorFormState) =>
      adminApi.createUptime({
        name: input.name.trim(),
        url: input.url.trim(),
        method: input.method,
        interval: Number.parseInt(input.interval, 10) || 300,
        expected_status: input.expected_status,
        timeout_ms: Number.parseInt(input.timeout_ms, 10) || 10_000,
        enabled: input.enabled,
      }),
    onSuccess: (body) => {
      invalidate();
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setFormError(null);
      setDetected(null);
      // The monitor is always created; the probe verdict only decides which
      // message is worth showing. Reporting "created" plus the reason the very
      // first check failed is more useful than a bare success toast.
      toast.success(t('toast.created'));
      const result = body.result;
      if (result !== undefined && !result.ok && result.error !== '') {
        toast.error(t('admin.uptime.checkedFail', { error: result.error }));
      }
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; input: MonitorFormState }) =>
      adminApi.updateUptime(args.id, {
        name: args.input.name.trim(),
        url: args.input.url.trim(),
        method: args.input.method,
        interval: Number.parseInt(args.input.interval, 10) || 300,
        expected_status: args.input.expected_status,
        timeout_ms: Number.parseInt(args.input.timeout_ms, 10) || 10_000,
        enabled: args.input.enabled,
      }),
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setEditing(null);
      setFormError(null);
      toast.success(t('toast.updated'));
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUptime(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('toast.deleted'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
    onSettled: () => setConfirm(null),
  });

  const toggleMutation = useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) =>
      adminApi.updateUptime(args.id, { enabled: args.enabled }),
    onSuccess: () => {
      invalidate();
      toast.success(t('toast.updated'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const checkMutation = useMutation({
    mutationFn: (id: string) => adminApi.checkUptime(id),
    onSuccess: (body) => {
      invalidate();
      const result = body.result;
      if (result === undefined) {
        toast.success(t('toast.updated'));
      } else if (result.ok) {
        toast.success(
          t('admin.uptime.checked', { status: result.status, ms: Math.round(result.latency_ms) }),
        );
      } else {
        toast.error(t('admin.uptime.checkedFail', { error: result.error }));
      }
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setProbe(null);
    setDetected(null);
    setFormOpen(true);
  };

  const openEdit = (monitor: UptimeMonitor) => {
    setEditing(monitor);
    setForm({
      name: monitor.name,
      url: monitor.url,
      method: monitor.method,
      interval: String(monitor.interval),
      expected_status: monitor.expected_status,
      timeout_ms: String(monitor.timeout_ms),
      enabled: monitor.enabled,
    });
    setFormError(null);
    setProbe(null);
    setDetected(null);
    setFormOpen(true);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.url.trim().length === 0) {
      setFormError(t('admin.uptime.urlRequired'));
      return;
    }
    if (editing === null) createMutation.mutate(form);
    else updateMutation.mutate({ id: editing.id, input: form });
  };

  /** Manual "get status code" click — same probe, but explicit. */
  const runProbe = async () => {
    const url = form.url.trim();
    if (url.length === 0) {
      setFormError(t('admin.uptime.urlRequired'));
      return;
    }
    setFormError(null);
    setProbing(true);
    try {
      const body = await adminApi.probeUptime(url, {
        method: form.method,
        timeout_ms: Number.parseInt(form.timeout_ms, 10) || undefined,
      });
      setProbe(body.result);
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    } finally {
      setProbing(false);
    }
  };

  /**
   * Expected-status choices.
   *
   * The probe result drives this list: when the URL answers HTTP 204 the
   * operator gets "204" as the first option (with the detected code spelled
   * out), plus the class wildcard and a sensible escape hatch. Without a probe
   * the list is the generic set of common codes.
   */
  const expectedOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    const push = (value: string, label: string) => {
      if (seen.has(value)) return;
      seen.add(value);
      options.push({ value, label });
    };

    const status = probe?.status ?? detected?.status ?? 0;
    if (status > 0) {
      push(String(status), `${status} ${t('admin.uptime.current')}`);
      const cls = `${Math.trunc(status / 100)}xx`;
      push(cls, `${cls.toUpperCase()} (${t('admin.uptime.expectedShort')} ${cls})`);
    }
    if (!seen.has('2xx')) push('2xx', '2XX (200–299)');
    push('200', '200');
    push('204', '204');
    push('301', '301');
    push('3xx', '3XX (300–399)');
    push('401', '401');
    push('403', '403');
    // Keep a custom value (e.g. "200,201") selectable after editing.
    const current = form.expected_status.trim();
    if (current !== '' && !seen.has(current)) push(current, current);
    return options;
  }, [probe, detected, form.expected_status, t]);

  const monitors = monitorsQuery.data?.monitors ?? [];
  const upCount = monitors.filter((monitor) => monitor.ok && monitor.last_checked > 0).length;

  const columns = useMemo<ReadonlyArray<Column<UptimeMonitor>>>(
    () => [
      {
        key: 'name',
        header: t('admin.uptime.monitor'),
        render: (monitor) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium text-text">{monitor.name}</span>
            <span className="truncate font-mono text-[11px] text-muted">{monitor.url}</span>
          </div>
        ),
      },
      {
        key: 'status',
        header: t('common.status'),
        render: (monitor) =>
          canEdit ? (
            <button
              type="button"
              onClick={() => toggleMutation.mutate({ id: monitor.id, enabled: !monitor.enabled })}
              disabled={toggleMutation.isPending}
              aria-pressed={monitor.enabled}
              title={t('admin.uptime.enabled')}
              className="rounded-full transition-opacity duration-150 hover:opacity-80 disabled:opacity-60"
            >
              <MonitorStatus monitor={monitor} />
            </button>
          ) : (
            <MonitorStatus monitor={monitor} />
          ),
      },
      {
        key: 'code',
        header: t('uptime.statusCode'),
        align: 'right',
        render: (monitor) =>
          monitor.last_checked === 0 ? (
            <span className="num text-muted">–</span>
          ) : monitor.last_status === 0 ? (
            <Badge tone="danger">{t('uptime.noResponse')}</Badge>
          ) : (
            <Badge tone={monitor.ok ? statusTone(monitor.last_status) : 'danger'}>
              {monitor.last_status}
            </Badge>
          ),
      },
      {
        key: 'latency',
        header: t('uptime.latency'),
        align: 'right',
        hideOnMobile: true,
        render: (monitor) =>
          monitor.last_checked === 0 ? (
            <span className="num text-muted">–</span>
          ) : (
            <span className="num text-muted">{Math.round(monitor.last_latency)} ms</span>
          ),
      },
      {
        key: 'uptime24h',
        header: t('uptime.uptime24h'),
        align: 'right',
        hideOnMobile: true,
        render: (monitor) => (
          <span
            className={`num ${
              monitor.uptime_24h < 0
                ? 'text-muted'
                : monitor.uptime_24h >= 99
                  ? 'text-text'
                  : 'text-warn'
            }`}
          >
            {uptimeText(monitor.uptime_24h)}
          </span>
        ),
      },
      {
        key: 'interval',
        header: t('uptime.interval'),
        align: 'right',
        hideOnMobile: true,
        render: (monitor) => <span className="num text-muted">{duration(monitor.interval, 1, lang)}</span>,
      },
      {
        key: 'lastCheck',
        header: t('admin.uptime.lastCheck'),
        align: 'right',
        hideOnMobile: true,
        render: (monitor) => (
          <span className="text-[11px] text-muted">
            {monitor.last_checked === 0 ? t('uptime.never') : relativeTime(monitor.last_checked, now, lang)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        render: (monitor) =>
          canEdit ? (
            <div className="flex items-center justify-end gap-1">
              <IconButton
                label={t('admin.uptime.checkNow')}
                onClick={() => checkMutation.mutate(monitor.id)}
                disabled={checkMutation.isPending}
              >
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path
                    d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton label={t('common.edit')} onClick={() => openEdit(monitor)}>
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path
                    d="M11.3 2.7 13.3 4.7 5.6 12.4 3 13l.6-2.6 7.7-7.7Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
              </IconButton>
              <IconButton
                label={t('common.delete')}
                onClick={() =>
                  setConfirm({
                    title: t('common.delete'),
                    message: t('admin.uptime.deleteConfirm', { name: monitor.name }),
                    confirmLabel: t('common.delete'),
                    danger: true,
                    onConfirm: () => deleteMutation.mutate(monitor.id),
                  })
                }
              >
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path
                    d="M3.5 5h9M6.5 5V3.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V5M5 5l.6 7.4a.8.8 0 0 0 .8.7h3.2a.8.8 0 0 0 .8-.7L11 5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </IconButton>
            </div>
          ) : null,
      },
    ],
    [t, lang, now, canEdit, toggleMutation, checkMutation, deleteMutation],
  );

  const pending = createMutation.isPending || updateMutation.isPending;
  const shownProbe = probe ?? detected;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.uptime.title')}
        subtitle={t('admin.uptime.subtitle')}
        actions={
          <>
            {monitors.length > 0 ? (
              <Badge tone={upCount === monitors.length ? 'success' : 'warn'} dot>
                {upCount}/{monitors.length}
              </Badge>
            ) : null}
            {canEdit ? (
              <Button
                variant="primary"
                onClick={openCreate}
                icon={
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                    <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                }
              >
                {t('admin.uptime.add')}
              </Button>
            ) : (
              <Badge tone="muted">{t('admin.readOnly')}</Badge>
            )}
          </>
        }
      />

      {monitorsQuery.isError ? (
        <ErrorBanner
          message={errorMessage(monitorsQuery.error)}
          onRetry={() => void monitorsQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      <section className="card p-5">
        <Table
          columns={columns}
          rows={monitors}
          rowKey={(monitor) => monitor.id}
          loading={monitorsQuery.isPending}
          loadingLabel={t('common.loading')}
          empty={
            <EmptyState compact title={t('admin.uptime.empty')} hint={t('admin.uptime.emptyHint')} />
          }
        />
      </section>

      <Modal
        open={formOpen}
        title={editing === null ? t('admin.uptime.create') : t('admin.uptime.edit')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="uptime-form" variant="primary" loading={pending}>
              {editing === null ? t('common.create') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="uptime-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t('admin.uptime.url')}
                hint={t('admin.uptime.urlHint')}
                value={form.url}
                onChange={(event) => {
                  const url = event.target.value;
                  // A result belongs to the URL it came from; keeping it after
                  // an edit would offer a stale status code for a new target.
                  setProbe(null);
                  setForm((current) => ({ ...current, url }));
                }}
                placeholder="https://example.com"
                className="font-mono"
                required
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => void runProbe()}
              loading={probing}
              disabled={form.url.trim().length === 0}
            >
              {probing ? t('admin.uptime.detecting') : t('admin.uptime.detect')}
            </Button>
          </div>

          {/* Probe readout: the status code the URL actually returned. */}
          {shownProbe !== null ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                shownProbe.ok
                  ? 'border-success/35 bg-success/10 text-success'
                  : 'border-danger/35 bg-danger/10 text-danger'
              }`}
              aria-live="polite"
            >
              <span className="min-w-0 break-words">
                {shownProbe.status > 0
                  ? t('admin.uptime.detected', {
                      status: shownProbe.status,
                      ms: Math.round(shownProbe.latency_ms),
                    })
                  : t('admin.uptime.detectedFail', { error: shownProbe.error })}
              </span>
              {shownProbe.status > 0 && shownProbe.status !== Number(form.expected_status) ? (
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({ ...current, expected_status: String(shownProbe.status) }))
                  }
                  className="shrink-0 rounded-lg border border-current/30 px-2 py-1 font-medium transition-colors duration-150 hover:bg-current/10"
                >
                  {t('admin.uptime.detectedHint', { status: shownProbe.status })}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('admin.uptime.name')}
              hint={t('admin.uptime.nameHint')}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <Select
              label={t('admin.uptime.expected')}
              hint={t('admin.uptime.expectedHint')}
              value={form.expected_status}
              onChange={(event) =>
                setForm((current) => ({ ...current, expected_status: event.target.value }))
              }
              options={expectedOptions}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label={t('admin.uptime.method')}
              value={form.method}
              onChange={(event) =>
                setForm((current) => ({ ...current, method: event.target.value as UptimeMethod }))
              }
              options={METHOD_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <Select
              label={t('admin.uptime.interval')}
              value={form.interval}
              onChange={(event) => setForm((current) => ({ ...current, interval: event.target.value }))}
              options={INTERVAL_OPTIONS.map((seconds) => ({
                value: String(seconds),
                label: duration(seconds, 1, lang),
              }))}
            />
            <Input
              label={t('admin.uptime.timeout')}
              type="number"
              min={1000}
              max={30000}
              step={1000}
              value={form.timeout_ms}
              onChange={(event) => setForm((current) => ({ ...current, timeout_ms: event.target.value }))}
            />
          </div>

          <Checkbox
            label={t('admin.uptime.enabled')}
            checked={form.enabled}
            onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
          />
          {formError !== null ? <FormError message={formError} /> : null}
        </form>
      </Modal>

      <ConfirmDialog
        state={confirm}
        cancelLabel={t('common.cancel')}
        loading={deleteMutation.isPending}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
