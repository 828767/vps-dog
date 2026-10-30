import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options: ReadonlyArray<SelectOption>;
  wrapperClassName?: string;
}

/** Native select — keyboard- and mobile-friendly, styled to match the theme. */
export function Select({
  label,
  hint,
  options,
  wrapperClassName = '',
  className = '',
  ...rest
}: SelectProps): ReactNode {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  const describedBy = hint !== undefined ? `${id}-desc` : undefined;

  const control = (
    <div className="relative">
      <select
        id={id}
        aria-describedby={describedBy}
        className={`w-full cursor-pointer appearance-none rounded-xl border border-border bg-surface-2 py-2 pr-9 pl-3 text-sm text-text transition-colors duration-150 hover:border-muted/40 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled === true}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 6l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );

  if (label === undefined) return control;

  return (
    <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {control}
      {hint !== undefined ? (
        <p id={describedBy} className="text-xs text-muted/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
