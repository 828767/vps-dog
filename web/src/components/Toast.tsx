import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

export interface ToastContextValue {
  toasts: ReadonlyArray<Toast>;
  push: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-success/40 text-success',
  error: 'border-danger/40 text-danger',
  info: 'border-border text-text',
};

const TONE_ICON: Record<ToastTone, ReactNode> = {
  success: (
    <path
      d="M4 8.5l2.6 2.6L12 5.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  error: (
    <path
      d="M8 4.6v4.2M8 11.2h.01"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  info: <path d="M8 7.2v4M8 4.8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
};

const TOAST_TTL_MS = 3_500;

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<ReadonlyArray<Toast>>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, tone, message }]);
      const timer = window.setTimeout(() => dismiss(id), TOAST_TTL_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const success = useCallback((message: string) => push(message, 'success'), [push]);
  const error = useCallback((message: string) => push(message, 'error'), [push]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, success, error, dismiss }),
    [toasts, push, success, error, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 text-sm shadow-sm ${
              TONE_CLASS[toast.tone]
            }`}
          >
            <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
              {TONE_ICON[toast.tone]}
            </svg>
            <p className="flex-1 break-words text-text">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mr-1 rounded-md p-1 text-muted transition-colors duration-150 hover:text-text"
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx === null) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
