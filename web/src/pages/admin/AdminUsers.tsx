import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Button, IconButton } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { FormError } from '../../components/Notice';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { Table, type Column } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { User, UserRole } from '../../lib/types';
import { useAdminAuth } from './AdminLayout';
import { ConfirmDialog, type ConfirmState } from './AdminDialogs';

/** `/admin/users` — account CRUD. */
export default function AdminUsers(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser, canEdit } = useAdminAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('admin');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const usersQuery = useQuery({
    queryKey: qk.adminUsers,
    queryFn: ({ signal }) => adminApi.listUsers(signal),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () => adminApi.createUser(username.trim(), password, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.adminUsers });
      setFormOpen(false);
      setUsername('');
      setPassword('');
      setRole('admin');
      setFormError(null);
      toast.success(t('toast.created'));
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.adminUsers });
      toast.success(t('toast.deleted'));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
    onSettled: () => setConfirm(null),
  });

  const users = usersQuery.data?.users ?? [];

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username.trim().length === 0 || password.length < 6) {
      setFormError(t('common.required'));
      return;
    }
    createMutation.mutate();
  };

  const columns = useMemo<ReadonlyArray<Column<User>>>(
    () => [
      {
        key: 'username',
        header: t('admin.users.username'),
        render: (user) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-text">{user.username}</span>
            {user.id === currentUser.id ? <Badge tone="accent">{t('admin.users.you')}</Badge> : null}
          </div>
        ),
      },
      {
        key: 'role',
        header: t('admin.users.role'),
        render: (user) => (
          <Badge tone={user.role === 'admin' ? 'accent' : 'muted'}>
            {t(user.role === 'admin' ? 'admin.users.role.admin' : 'admin.users.role.viewer')}
          </Badge>
        ),
      },
      {
        key: 'id',
        header: t('common.id'),
        hideOnMobile: true,
        render: (user) => <code className="font-mono text-[11px] text-muted">{user.id.slice(0, 8)}…</code>,
      },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'right',
        render: (user) =>
          canEdit ? (
            <IconButton
              label={t('common.delete')}
              disabled={user.id === currentUser.id}
              onClick={() =>
                setConfirm({
                  title: t('common.delete'),
                  message: t('admin.users.deleteConfirm', { name: user.username }),
                  confirmLabel: t('common.delete'),
                  danger: true,
                  onConfirm: () => deleteMutation.mutate(user.id),
                })
              }
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M3.5 5h9M6.5 5V3.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V5M5 5l.6 7.4a.8.8 0 0 0 .8.7h3.2a.8.8 0 0 0 .8-.7L11 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
          ) : null,
      },
    ],
    [t, currentUser.id, canEdit, deleteMutation],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.users.title')}
        subtitle={t('admin.users.subtitle')}
        actions={
          canEdit ? (
            <Button
              variant="primary"
              onClick={() => {
                setUsername('');
                setPassword('');
                setRole('admin');
                setFormError(null);
                setFormOpen(true);
              }}
              icon={
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              }
            >
              {t('admin.users.add')}
            </Button>
          ) : (
            <Badge tone="muted">{t('admin.readOnly')}</Badge>
          )
        }
      />

      {usersQuery.isError ? (
        <ErrorBanner
          message={errorMessage(usersQuery.error)}
          onRetry={() => void usersQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      <section className="card p-5">
        <Table
          columns={columns}
          rows={users}
          rowKey={(user) => user.id}
          loading={usersQuery.isPending}
          loadingLabel={t('common.loading')}
          empty={<EmptyState compact title={t('admin.users.empty')} hint={t('admin.users.emptyHint')} />}
          caption={
            usersQuery.dataUpdatedAt > 0 ? (
              <span className="num">{dateTime(Math.floor(usersQuery.dataUpdatedAt / 1000))}</span>
            ) : undefined
          }
        />
      </section>

      <Modal
        open={formOpen}
        title={t('admin.users.create')}
        onClose={() => setFormOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={createMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="user-form" variant="primary" loading={createMutation.isPending}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <form id="user-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input
            label={t('admin.users.username')}
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            autoFocus
          />
          <Input
            label={t('admin.users.password')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Select
            label={t('admin.users.role')}
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            options={[
              { value: 'admin', label: t('admin.users.role.admin') },
              { value: 'viewer', label: t('admin.users.role.viewer') },
            ]}
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
