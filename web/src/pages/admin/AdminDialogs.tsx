import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, IconButton } from '../../components/Button';
import { Input } from '../../components/Input';
import { FormError } from '../../components/Notice';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { copyText } from '../../lib/clipboard';
import { authApi, errorMessage } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { buildInstallCommand } from '../../lib/install';

export interface TokenDialogProps {
  open: boolean;
  /** Node the token belongs to; `null` while closed. */
  nodeName: string | null;
  token: string | null;
  /** Prefills `-r` in the install command; omitted when the node has no region. */
  region?: string | null;
  onClose: () => void;
}

const COPY_ICON = (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </svg>
);

/**
 * Shows a freshly minted agent token exactly once — together with a
 * ready-to-paste command that installs the agent and wires the token up, which
 * is what the operator actually needs after registering a node.
 */
export function TokenDialog({
  open,
  nodeName,
  token,
  region = null,
  onClose,
}: TokenDialogProps): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState<'token' | 'command' | null>(null);

  const command =
    token === null || nodeName === null
      ? ''
      : buildInstallCommand({
          origin: window.location.origin,
          token,
          nodeName,
          region,
        });

  const copy = async (what: 'token' | 'command', value: string) => {
    if (value.length === 0) return;
    const ok = await copyText(value);
    if (!ok) {
      toast.error(t('common.copyFailed'));
      return;
    }
    setCopied(what);
    toast.success(t('toast.copied'));
    window.setTimeout(() => setCopied((current) => (current === what ? null : current)), 2_000);
  };

  return (
    <Modal
      open={open}
      title={t('admin.nodes.tokenFor', { name: nodeName ?? '' })}
      description={t('admin.nodes.tokenOnce')}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void copy('command', command)}
            icon={COPY_ICON}
          >
            {copied === 'command' ? t('common.copied') : t('admin.nodes.copyCommand')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
              {t('admin.nodes.tokenHint')}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={COPY_ICON}
              onClick={() => void copy('token', token ?? '')}
            >
              {copied === 'token' ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
          <code className="block max-h-28 overflow-auto rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs break-all text-text select-all">
            {token ?? '–'}
          </code>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
            {t('admin.nodes.installTitle')}
          </span>
          <pre className="max-h-44 overflow-auto rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-text select-all">
            {command}
          </pre>
        </section>

        <p className="text-[11px] leading-relaxed text-muted">{t('admin.nodes.installHint')}</p>
      </div>
    </Modal>
  );
}

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Change the signed-in account's password (`POST /api/auth/password`).
 * The worker verifies the current password; sessions stay valid afterwards.
 */
export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    onClose();
  };

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword(oldPassword, newPassword),
    onSuccess: () => {
      toast.success(t('admin.password.changed'));
      close();
    },
    onError: (cause: unknown) => setError(errorMessage(cause)),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (oldPassword === '' || newPassword === '') {
      setError(t('common.required'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('admin.password.confirmMismatch'));
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      title={t('admin.password.title')}
      onClose={close}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="password-form" variant="primary" loading={mutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="password-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label={t('admin.password.old')}
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
          required
          autoFocus
        />
        <Input
          label={t('admin.password.new')}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
        <Input
          label={t('admin.password.confirm')}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
        {error !== null && error.length > 0 ? <FormError message={error} /> : null}
      </form>
    </Modal>
  );
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
  /** Optional copyable command block shown under the message (e.g. the agent
   *  uninstall one-liner when deleting a node). */
  code?: { label: string; text: string; hint?: string };
  codeLabel?: string;
}

export interface ConfirmDialogProps {
  state: ConfirmState | null;
  cancelLabel: string;
  loading: boolean;
  onCancel: () => void;
}

export function ConfirmDialog({ state, cancelLabel, loading, onCancel }: ConfirmDialogProps): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (state?.code === undefined) return;
    const ok = await copyText(state.code.text);
    if (!ok) {
      toast.error(t('common.copyFailed'));
      return;
    }
    setCopied(true);
    toast.success(t('toast.copied'));
    window.setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <Modal
      open={state !== null}
      title={state?.title ?? ''}
      onClose={onCancel}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={state?.danger === true ? 'danger' : 'primary'}
            onClick={() => state?.onConfirm()}
            loading={loading}
          >
            {state?.confirmLabel ?? ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-muted">{state?.message ?? ''}</p>
        {state?.code !== undefined ? (
          <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
                {state.code.label}
              </span>
              <Button size="sm" variant="ghost" icon={COPY_ICON} onClick={() => void copyCode()}>
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
            </div>
            <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-text select-all">
              {state.code.text}
            </pre>
            {state.code.hint !== undefined ? (
              <p className="text-[11px] leading-relaxed text-muted">{state.code.hint}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

export interface RowActionsProps {
  children: ReactNode;
}

export function RowActions({ children }: RowActionsProps): ReactNode {
  return <div className="flex items-center justify-end gap-1">{children}</div>;
}

export { IconButton };
