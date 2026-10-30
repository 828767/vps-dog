import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** `sm` for confirms, `md` for forms. */
  size?: 'sm' | 'md';
}

/** Accessible dialog: Esc closes, backdrop click closes, focus is trapped-ish
 *  by moving focus into the panel and restoring it on close. */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: ModalProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  // Callers pass inline arrow functions, so `onClose` gets a new identity on
  // every render. Reading it through a ref keeps the open/close effect keyed
  // on `open` alone — with `onClose` in the dependency array the effect would
  // re-run on EVERY keystroke inside the dialog (typing state → re-render →
  // new closure), yanking focus away from the input after each character.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full rounded-t-2xl border border-border bg-surface outline-none sm:rounded-2xl ${
          size === 'sm' ? 'sm:max-w-md' : 'sm:max-w-xl'
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-text">{title}</h2>
            {description !== undefined ? (
              <p className="text-xs text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer !== undefined ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps): ReactNode {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{message}</p>
    </Modal>
  );
}
