import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
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
import { duration } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { AdminPingTask, PingType } from '../../lib/types';
import { ConfirmDialog, type ConfirmState } from './AdminDialogs';
import { useAdminAuth } from './AdminLayout';

interface PingFormState {
  node_id: string;
  name: string;
  type: PingType;
  target: string;
  interval: string;
  enabled: boolean;
}

const EMPTY_FORM: PingFormState = {
  node_id: '',
  name: '',
  type: 'tcp',
  target: '',
  interval: '60',
  enabled: true,
};

const TYPE_OPTIONS: ReadonlyArray<{ value: PingType; label: string }> = [
  { value: 'icmp', label: 'ICMP' },
  { value: 'tcp', label: 'TCP' },
  { value: 'http', label: 'HTTP' },
];

/** `/admin/pings` — probe task CRUD with a node filter. */
export default function AdminPings(): ReactNode {
  const { t, lang } = useI18n();
  const { canEdit } = useAdminAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [nodeFilter, setNodeFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPingTask | null>(null);
  const [form, setForm] = useState<PingFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const nodesQuery = useQuery({
    queryKey: qk.adminNodes,
    queryFn: ({ signal }) => adminApi.listNodes(signal),
    staleTime: 60_000,
  });

  const pingsQuery = useQuery({
    queryKey: qk.adminPings(nodeFilter === 'all' ? undefined : nodeFilter),
    queryFn: ({ signal }) =>
      adminApi.listPings(nodeFilter === 'all' ? undefined : nodeFilter, signal),
    staleTime: 10_000,
  });

  const nodeName = useCallback(
    (id: string): string =>
      nodesQuery.data?.nodes.find((node) => node.id === id)?.name ?? `${id.slice(0, 8)}…`,
    [nodesQuery.data],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'pings'] });
    void queryClient.invalidateQueries({ queryKey: qk.nodes });
  };

  const createMutation = useMutation({
    mutationFn: (input: PingFormState) =>
      adminApi.createPing({
        node_id: input.node_id,
        name: input.name.trim(),
        type: input.type,
        target: input.target.trim(),
        interval: Number.parseInt(input.interval, 10) || 60,
        enabled: input.enabled,
      }),
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setFormError(null);
      toast.success(t('toast.created'));
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; input: PingFormState }) =>
      adminApi.updatePing(args.id, {
        name: args.input.name.trim(),
        type: args.input.type,
        target: args.input.target.trim(),
        interval: Number.parseInt(args.input.interval, 10) || 60,
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
    mutationFn: (id: string) => adminApi.deletePing(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('toast.deleted'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
    onSettled: () => setConfirm(null),
  });

  const toggleMutation = useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) =>
      adminApi.updatePing(args.id, { enabled: args.enabled }),
    onSuccess: () => {
      invalidate();
      toast.success(t('toast.updated'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const nodeOptions = useMemo(
    () => [
      { value: 'all', label: t('admin.pings.allNodes') },
      ...(nodesQuery.data?.nodes ?? []).map((node) => ({ value: node.id, label: node.name })),
    ],
    [nodesQuery.data, t],
  );

  const formNodeOptions = useMemo(
    () => [
      { value: '', label: `— ${t('admin.pings.node')} —`, disabled: true },
      ...(nodesQuery.data?.nodes ?? []).map((node) => ({ value: node.id, label: node.name })),
    ],
    [nodesQuery.data, t],
  );

  const rows = pingsQuery.data?.pings ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      node_id: nodeFilter === 'all' ? (nodesQuery.data?.nodes[0]?.id ?? '') : nodeFilter,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (ping: AdminPingTask) => {
    setEditing(ping);
    setForm({
      node_id: ping.node_id,
      name: ping.name,
      type: ping.type,
      target: ping.target,
      interval: String(ping.interval),
      enabled: ping.enabled,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.node_id.length === 0 || form.name.trim().length === 0 || form.target.trim().length === 0) {
      setFormError(t('common.required'));
      return;
    }
    if (editing === null) createMutation.mutate(form);
    else updateMutation.mutate({ id: editing.id, input: form });
  };

  const columns = useMemo<ReadonlyArray<Column<AdminPingTask>>>(
    () => [
      {
        key: 'name',
        header: t('admin.pings.name'),
        render: (ping) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium text-text">{ping.name}</span>
            <span className="truncate font-mono text-[11px] text-muted">{ping.target}</span>
          </div>
        ),
      },
      {
        key: 'node',
        header: t('admin.pings.node'),
        render: (ping) => <Badge tone="accent">{nodeName(ping.node_id)}</Badge>,
      },
      {
        key: 'type',
        header: t('admin.pings.type'),
        render: (ping) => <Badge>{ping.type.toUpperCase()}</Badge>,
      },
      {
        key: 'interval',
        header: t('admin.pings.interval'),
        align: 'right',
        hideOnMobile: true,
        render: (ping) => <span className="num text-muted">{duration(ping.interval, 2, lang)}</span>,
      },
      {
        key: 'enabled',
        header: t('common.status'),
        render: (ping) => {
          const badge = (
            <Badge tone={ping.enabled ? 'success' : 'muted'} dot>
              {ping.enabled ? t('ping.enabled') : t('ping.disabled')}
            </Badge>
          );
          // A viewer cannot PATCH, so show the state as plain text rather than
          // as a control the request would reject.
          if (!canEdit) return badge;
          return (
            <button
              type="button"
              onClick={() => toggleMutation.mutate({ id: ping.id, enabled: !ping.enabled })}
              disabled={toggleMutation.isPending}
              aria-pressed={ping.enabled}
              className="rounded-full transition-opacity duration-150 hover:opacity-80 disabled:opacity-60"
            >
              {badge}
            </button>
          );
        },
      },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        render: (ping) =>
          canEdit ? (
            <div className="flex items-center justify-end gap-1">
              <IconButton label={t('common.edit')} onClick={() => openEdit(ping)}>
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path d="M11.3 2.7 13.3 4.7 5.6 12.4 3 13l.6-2.6 7.7-7.7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
              </IconButton>
              <IconButton
                label={t('common.delete')}
                onClick={() =>
                  setConfirm({
                    title: t('common.delete'),
                    message: t('admin.pings.deleteConfirm', { name: ping.name }),
                    confirmLabel: t('common.delete'),
                    danger: true,
                    onConfirm: () => deleteMutation.mutate(ping.id),
                  })
                }
              >
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path d="M3.5 5h9M6.5 5V3.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V5M5 5l.6 7.4a.8.8 0 0 0 .8.7h3.2a.8.8 0 0 0 .8-.7L11 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </IconButton>
            </div>
          ) : null,
      },
    ],
    [t, lang, nodeName, canEdit, toggleMutation, deleteMutation],
  );

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.pings.title')}
        subtitle={t('admin.pings.subtitle')}
        actions={
          <>
            <div className="w-48">
              <Select
                aria-label={t('admin.pings.filterNode')}
                value={nodeFilter}
                onChange={(event) => setNodeFilter(event.target.value)}
                options={nodeOptions}
              />
            </div>
            {canEdit ? (
              <Button
                variant="primary"
                onClick={openCreate}
                disabled={(nodesQuery.data?.nodes.length ?? 0) === 0}
                icon={
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                    <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                }
              >
                {t('admin.pings.add')}
              </Button>
            ) : (
              <Badge tone="muted">{t('admin.readOnly')}</Badge>
            )}
          </>
        }
      />

      {pingsQuery.isError ? (
        <ErrorBanner
          message={errorMessage(pingsQuery.error)}
          onRetry={() => void pingsQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      <section className="card p-5">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(ping) => ping.id}
          loading={pingsQuery.isPending}
          loadingLabel={t('common.loading')}
          empty={<EmptyState compact title={t('admin.pings.empty')} hint={t('admin.pings.emptyHint')} />}
        />
      </section>

      <Modal
        open={formOpen}
        title={editing === null ? t('admin.pings.create') : t('admin.pings.edit')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="ping-form" variant="primary" loading={pending}>
              {editing === null ? t('common.create') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="ping-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Select
            label={t('admin.pings.node')}
            value={form.node_id}
            onChange={(event) => setForm((current) => ({ ...current, node_id: event.target.value }))}
            options={formNodeOptions}
            disabled={editing !== null}
            required
          />
          <Input
            label={t('admin.pings.name')}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            required
            autoFocus
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label={t('admin.pings.type')}
              value={form.type}
              onChange={(event) =>
                setForm((current) => ({ ...current, type: event.target.value as PingType }))
              }
              options={TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <Input
              label={t('admin.pings.interval')}
              type="number"
              min={10}
              max={3600}
              value={form.interval}
              onChange={(event) => setForm((current) => ({ ...current, interval: event.target.value }))}
            />
          </div>
          <Input
            label={t('admin.pings.target')}
            hint={t('admin.pings.targetHint')}
            value={form.target}
            onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
            required
            className="font-mono"
          />
          <Checkbox
            label={t('admin.pings.enabled')}
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
