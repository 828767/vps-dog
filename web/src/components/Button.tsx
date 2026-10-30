import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';
import { PILL_FILL, PILL_IDLE } from './pill';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'pill' | 'pill-surface';
/** `pill` / `pill-surface` match the header controls (`h-8.5`, `rounded-xl`). */
export type ButtonSize = 'sm' | 'md' | 'pill';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon; hidden while `loading`. */
  icon?: ReactNode;
  block?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white border border-transparent hover:brightness-110 active:brightness-95 disabled:hover:brightness-100',
  secondary:
    'bg-surface-2 text-text border border-border hover:border-muted/45 hover:bg-surface-2/80',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-text',
  danger:
    'bg-danger/12 text-danger border border-danger/35 hover:bg-danger/20 hover:border-danger/55',
  // Same chrome as the header's theme / language pills. The border *width* has
  // to be spelled out here — the shared tokens only carry the border colour.
  pill: `border ${PILL_IDLE} ${PILL_FILL.canvas}`,
  'pill-surface': `border ${PILL_IDLE} ${PILL_FILL.surface}`,
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-lg',
  md: 'h-9.5 px-3.5 text-sm gap-2 rounded-xl',
  pill: 'h-8.5 px-2.5 text-xs gap-1.5 rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-55 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${
        block ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls must be announced. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'size-8',
  md: 'size-9.5',
  pill: 'size-8.5',
};

export function IconButton({
  label,
  variant = 'ghost',
  size = 'sm',
  className = '',
  children,
  type = 'button',
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-lg border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 ${
        ICON_SIZE_CLASS[size]
      } ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
