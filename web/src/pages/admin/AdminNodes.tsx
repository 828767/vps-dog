import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Badge, StatusDot } from '../../components/Badge';
import { Button, IconButton } from '../../components/Button';
import { Checkbox, Input } from '../../components/Input';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { FormError } from '../../components/Notice';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { Table, type Column } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { daysUntil, quota, relativeTime } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { buildUninstallCommand } from '../../lib/install';
import { useNow } from '../../lib/useLive';
import type { AdminNode } from '../../lib/types';
import { ConfirmDialog, TokenDialog, type ConfirmState } from './AdminDialogs';
import { useAdminAuth } from './AdminLayout';

interface NodeFormState {
  name: string;
  group: string;
  region: string;
  tags: string;
  hidden: boolean;
  sort_order: string;
  price: string;
  traffic_gb: string;
  traffic_both: boolean;
  /** Manual "used this month" override in GB; '' = leave as metered. */
  traffic_used_gb: string;
  expires_at: string;
  notify: boolean;
}

const EMPTY_FORM: NodeFormState = {
  name: '',
  group: 'default',
  region: '',
  tags: '',
  hidden: false,
  sort_order: '0',
  price: '',
  traffic_gb: '',
  traffic_both: true,
  traffic_used_gb: '',
  expires_at: '',
  notify: true,
};

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function toForm(node: AdminNode): NodeFormState {
  return {
    name: node.name,
    group: node.group,
    region: node.region,
    tags: node.tags.join(', '),
    hidden: node.hidden,
    sort_order: String(node.sort_order),
    price: node.price,
    traffic_gb: node.traffic_gb > 0 ? String(node.traffic_gb) : '',
    traffic_both: node.traffic_both,
    // Prefilled with the number currently displayed, rounded to 0.1 GB, so
    // saving without touching it is a no-op rather than a surprise reset.
    traffic_used_gb:
      node.traffic_used > 0 ? String(Math.round((node.traffic_used / 1024 ** 3) * 10) / 10) : '',
    expires_at: node.expires_at,
    notify: node.notify,
  };
}

/** Shared create/edit payload built from the form state. */
function planPayload(form: NodeFormState) {
  return {
    price: form.price.trim(),
    traffic_gb: Number.parseInt(form.traffic_gb, 10) || 0,
    traffic_both: form.traffic_both,
    // Only sent when set: an empty box means "keep metering automatically".
    ...(form.traffic_used_gb.trim() === ''
      ? {}
      : { traffic_used_gb: Math.max(0, Number.parseFloat(form.traffic_used_gb) || 0) }),
    expires_at: form.expires_at,
    notify: form.notify,
  };
}

/** `/admin/nodes` — node CRUD, token issuance/rotation, visibility and order. */
export default function AdminNodes(): ReactNode {
  const { t, lang } = useI18n();
  const { canEdit } = useAdminAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow(5_000);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminNode | null>(null);
  const [form, setForm] = useState<NodeFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenDialog, setTokenDialog] = useState<{
    name: string;
    token: string;
    region: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const nodesQuery = useQuery({
    queryKey: qk.adminNodes,
    queryFn: ({ signal }) => adminApi.listNodes(signal),
    staleTime: 10_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.adminNodes });
    void queryClient.invalidateQueries({ queryKey: qk.nodes });
    void queryClient.invalidateQueries({ queryKey: qk.groups });
  };

  const createMutation = useMutation({
    mutationFn: (input: NodeFormState) =>
      adminApi.createNode({
        name: input.name.trim(),
        group: input.group.trim().length > 0 ? input.group.trim() : 'default',
        region: input.region.trim(),
        tags: parseTags(input.tags),
        hidden: input.hidden,
        sort_order: Number.parseInt(input.sort_order, 10) || 0,
        ...planPayload(input),
      }),
    onSuccess: (data, variables) => {
      invalidate();
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setFormError(null);
      setTokenDialog({
        name: variables.name.trim(),
        token: data.token,
        region: variables.region.trim(),
      });
      toast.success(t('toast.created'));
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; input: NodeFormState }) =>
      adminApi.updateNode(args.id, {
        name: args.input.name.trim(),
        group: args.input.group.trim().length > 0 ? args.input.group.trim() : 'default',
        region: args.input.region.trim(),
        tags: parseTags(args.input.tags),
        hidden: args.input.hidden,
        sort_order: Number.parseInt(args.input.sort_order, 10) || 0,
        ...planPayload(args.input),
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
    mutationFn: (id: string) => adminApi.deleteNode(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('toast.deleted'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
    onSettled: () => setConfirm(null),
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) => adminApi.rotateToken(id),
    onSuccess: (data, id) => {
      invalidate();
      const node = nodesQuery.data?.nodes.find((candidate) => candidate.id === id);
      setTokenDialog({
        name: node?.name ?? '',
        token: data.token,
        region: node?.region ?? '',
      });
      toast.success(t('toast.updated'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
    onSettled: () => setConfirm(null),
  });

  const toggleHiddenMutation = useMutation({
    mutationFn: (args: { id: string; hidden: boolean }) =>
      adminApi.updateNode(args.id, { hidden: args.hidden }),
    onSuccess: () => {
      invalidate();
      toast.success(t('toast.updated'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const reorderMutation = useMutation({
    mutationFn: (args: { id: string; sort_order: number }) =>
      adminApi.updateNode(args.id, { sort_order: args.sort_order }),
    onSuccess: () => {
      invalidate();
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const nodes = useMemo<ReadonlyArray<AdminNode>>(
    () =>
      [...(nodesQuery.data?.nodes ?? [])].sort(
        (a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at,
      ),
    [nodesQuery.data],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (node: AdminNode) => {
    setEditing(node);
    setForm(toForm(node));
    setFormError(null);
    setFormOpen(true);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.name.trim().length === 0) {
      setFormError(t('common.required'));
      return;
    }
    if (editing === null) createMutation.mutate(form);
    else updateMutation.mutate({ id: editing.id, input: form });
  };

  const move = useCallback(
    (node: AdminNode, direction: -1 | 1) => {
      const index = nodes.findIndex((candidate) => candidate.id === node.id);
      const target = nodes[index + direction];
      const nextOrder = target !== undefined ? target.sort_order : node.sort_order + direction * 10;
      reorderMutation.mutate({ id: node.id, sort_order: nextOrder });
    },
    [nodes, reorderMutation],
  );

  const columns = useMemo<ReadonlyArray<Column<AdminNode>>>(
    () => [
      {
        key: 'name',
        header: t('admin.nodes.name'),
        render: (node) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium text-text">
              <StatusDot
                online={node.online}
                label={node.online ? t('status.online') : t('status.offline')}
                size="sm"
              />
              <span className="truncate">{node.name}</span>
            </span>
            <span className="num text-[11px] text-muted">{node.id.slice(0, 8)}…</span>
          </div>
        ),
      },
      {
        key: 'group',
        header: t('admin.nodes.group'),
        render: (node) => (
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone="accent">{node.group}</Badge>
            {node.region.length > 0 ? <Badge tone="muted">{node.region}</Badge> : null}
          </div>
        ),
      },
      {
        key: 'tags',
        header: t('admin.nodes.tags'),
        hideOnMobile: true,
        render: (node) =>
          node.tags.length === 0 ? (
            <span className="text-muted">–</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {node.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          ),
      },
      {
        key: 'plan',
        header: t('admin.nodes.plan'),
        hideOnMobile: true,
        render: (node) => {
          const parts: string[] = [];
          if (node.price.length > 0) parts.push(node.price);
          if (node.traffic_gb > 0) parts.push(quota(node.traffic_gb));
          if (node.expires_at.length > 0) {
            const days = daysUntil(node.expires_at, now);
            const expired = days <= 0;
            const soon = days <= 30;
            parts.push(
              `${t('node.expires')} ${node.expires_at}${expired ? ` · ${t('node.expired')}` : soon ? ` · ${days}d` : ''}`,
            );
          }
          if (parts.length === 0) return <span className="text-muted">–</span>;
          const expired = node.expires_at.length > 0 && daysUntil(node.expires_at, now) <= 0;
          // No `num` face: the price is free-form text (often CJK) that the
          // monospaced digits font cannot render.
          return (
            <span className={`text-[11px] ${expired ? 'text-danger' : 'text-text'}`}>
              {parts.join(' · ')}
            </span>
          );
        },
      },
      {
        key: 'token',
        header: t('admin.nodes.tokenHint'),
        hideOnMobile: true,
        render: (node) => (
          <code className="font-mono text-[11px] text-muted">{node.token_hint || '–'}</code>
        ),
      },
      {
        key: 'status',
        header: t('common.status'),
        render: (node) => (
          <div className="flex flex-col gap-0.5">
            <span className="num text-[11px] text-text">
              {node.last_seen > 0 ? relativeTime(node.last_seen, now, lang) : t('common.never')}
            </span>
            <span className="text-[11px] text-muted">
              {node.hidden ? t('common.hidden') : t('common.visible')}
            </span>
          </div>
        ),
      },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        render: (node, index) =>
          canEdit ? (
            <div className="flex items-center justify-end gap-1">
            <IconButton
              label={t('admin.nodes.moveUp')}
              onClick={() => move(node, -1)}
              disabled={index === 0 || reorderMutation.isPending}
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M8 12V4M4.5 7.5 8 4l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
            <IconButton
              label={t('admin.nodes.moveDown')}
              onClick={() => move(node, 1)}
              disabled={index === nodes.length - 1 || reorderMutation.isPending}
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M8 4v8M4.5 8.5 8 12l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
            <IconButton
              label={node.hidden ? t('admin.nodes.show') : t('admin.nodes.hide')}
              onClick={() => toggleHiddenMutation.mutate({ id: node.id, hidden: !node.hidden })}
              disabled={toggleHiddenMutation.isPending}
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                {node.hidden ? (
                  <path d="M2 8s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4Zm4.2 0a1.8 1.8 0 1 1 3.6 0 1.8 1.8 0 0 1-3.6 0ZM3 3l10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                ) : (
                  <>
                    <path d="M1.8 8S4.2 4 8 4s6.2 4 6.2 4-2.4 4-6.2 4S1.8 8 1.8 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.4" />
                  </>
                )}
              </svg>
            </IconButton>
            <IconButton label={t('common.edit')} onClick={() => openEdit(node)}>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M11.3 2.7 13.3 4.7 5.6 12.4 3 13l.6-2.6 7.7-7.7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </IconButton>
            <IconButton
              label={t('admin.nodes.rotate')}
              onClick={() =>
                setConfirm({
                  title: t('admin.nodes.rotate'),
                  message: t('admin.nodes.rotateConfirm', { name: node.name }),
                  confirmLabel: t('common.confirm'),
                  danger: true,
                  onConfirm: () => rotateMutation.mutate(node.id),
                })
              }
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M13.4 6.6A5.4 5.4 0 0 0 3.5 5.1M2.6 9.4a5.4 5.4 0 0 0 9.9 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M13.7 3.3v3.4h-3.4M2.3 12.7V9.3h3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
            <IconButton
              label={t('common.delete')}
              onClick={() =>
                setConfirm({
                  title: t('common.delete'),
                  message: t('admin.nodes.deleteConfirm', { name: node.name }),
                  confirmLabel: t('common.delete'),
                  danger: true,
                  onConfirm: () => deleteMutation.mutate(node.id),
                  code: {
                    label: t('admin.nodes.deleteAgent'),
                    text: buildUninstallCommand(),
                    hint: t('admin.nodes.deleteAgentHint'),
                  },
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
    [t, lang, now, nodes, canEdit, deleteMutation.isPending, rotateMutation.isPending, reorderMutation.isPending, toggleHiddenMutation.isPending, move],
  );

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.nodes.title')}
        subtitle={t('admin.nodes.subtitle')}
        actions={
          canEdit ? (
            <Button
              variant="primary"
              onClick={openCreate}
              icon={
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              }
            >
              {t('admin.nodes.add')}
            </Button>
          ) : (
            <Badge tone="muted">{t('admin.readOnly')}</Badge>
          )
        }
      />

      {nodesQuery.isError ? (
        <ErrorBanner
          message={errorMessage(nodesQuery.error)}
          onRetry={() => void nodesQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      <section className="card p-5">
        <Table
          columns={columns}
          rows={nodes}
          rowKey={(node) => node.id}
          loading={nodesQuery.isPending}
          loadingLabel={t('common.loading')}
          empty={<EmptyState compact title={t('admin.nodes.empty')} hint={t('admin.nodes.emptyHint')} />}
          caption={
            nodes.length > 0 ? (
              <span className="num">
                {t('status.total')}: {nodes.length}
              </span>
            ) : undefined
          }
        />
      </section>

      {/* create / edit */}
      <Modal
        open={formOpen}
        title={editing === null ? t('admin.nodes.create') : t('admin.nodes.edit')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="node-form" variant="primary" loading={pending}>
              {editing === null ? t('common.create') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="node-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input
            label={t('admin.nodes.name')}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            required
            autoFocus
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('admin.nodes.group')}
              value={form.group}
              onChange={(event) => setForm((current) => ({ ...current, group: event.target.value }))}
            />
            <Input
              label={t('admin.nodes.region')}
              value={form.region}
              onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))}
            />
          </div>
          <Input
            label={t('admin.nodes.tags')}
            hint={t('admin.nodes.tagsHint')}
            value={form.tags}
            onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
          />
          <Input
            label={t('admin.nodes.sortOrder')}
            type="number"
            inputMode="numeric"
            value={form.sort_order}
            onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label={t('admin.nodes.price')}
              hint={t('admin.nodes.priceHint')}
              value={form.price}
              onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
            />
            <Input
              label={t('admin.nodes.traffic')}
              hint={t('admin.nodes.trafficHint')}
              type="number"
              inputMode="numeric"
              min={0}
              value={form.traffic_gb}
              onChange={(event) => setForm((current) => ({ ...current, traffic_gb: event.target.value }))}
            />
            <Input
              label={t('admin.nodes.expires')}
              type="date"
              value={form.expires_at}
              onChange={(event) => setForm((current) => ({ ...current, expires_at: event.target.value }))}
            />
          </div>
          <Checkbox
            label={t('admin.nodes.trafficBoth')}
            hint={t('admin.nodes.trafficBothHint')}
            checked={form.traffic_both}
            onChange={(event) => setForm((current) => ({ ...current, traffic_both: event.target.checked }))}
          />
          <Input
            label={t('admin.nodes.trafficUsed')}
            hint={t('admin.nodes.trafficUsedHint')}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={form.traffic_used_gb}
            onChange={(event) => setForm((current) => ({ ...current, traffic_used_gb: event.target.value }))}
          />
          <Checkbox
            label={t('admin.nodes.hidden')}
            checked={form.hidden}
            onChange={(event) => setForm((current) => ({ ...current, hidden: event.target.checked }))}
          />
          <Checkbox
            label={t('admin.nodes.notify')}
            hint={t('admin.nodes.notifyHint')}
            checked={form.notify}
            onChange={(event) => setForm((current) => ({ ...current, notify: event.target.checked }))}
          />
          {formError !== null ? <FormError message={formError} /> : null}
        </form>
      </Modal>

      <TokenDialog
        open={tokenDialog !== null}
        nodeName={tokenDialog?.name ?? null}
        token={tokenDialog?.token ?? null}
        region={tokenDialog?.region ?? null}
        onClose={() => setTokenDialog(null)}
      />

      <ConfirmDialog
        state={confirm}
        cancelLabel={t('common.cancel')}
        loading={deleteMutation.isPending || rotateMutation.isPending}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
