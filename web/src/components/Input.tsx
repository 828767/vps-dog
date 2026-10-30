import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

const FIELD_CLASS =
  'w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted/70 transition-colors duration-150 hover:border-muted/40 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby': string | undefined }) => ReactNode;
}

/** Label + hint + error wrapper so every control is properly labelled. */
export function Field({ label, hint, error, required, children }: FieldProps): ReactNode {
  const id = useId();
  const describedBy = hint !== undefined || error !== undefined ? `${id}-desc` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy })}
      {error !== undefined ? (
        <p id={describedBy} className="text-xs text-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={describedBy} className="text-xs text-muted/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Classes for the wrapper when `label` is provided. */
  wrapperClassName?: string;
}

export function Input({
  label,
  hint,
  error,
  wrapperClassName = '',
  className = '',
  ...rest
}: InputProps): ReactNode {
  const generatedId = useId();
  const inputId = rest.id ?? generatedId;
  const describedBy = error !== undefined || hint !== undefined ? `${inputId}-desc` : undefined;

  const control = (
    <input
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={error !== undefined || undefined}
      className={`${FIELD_CLASS} ${className}`}
      {...rest}
    />
  );

  if (label === undefined) return control;

  return (
    <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
      <label htmlFor={inputId} className="text-xs font-medium text-muted">
        {label}
        {rest.required === true ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      {control}
      {error !== undefined ? (
        <p id={describedBy} className="text-xs text-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={describedBy} className="text-xs text-muted/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export function Textarea({
  label,
  hint,
  className = '',
  ...rest
}: TextareaProps): ReactNode {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  const describedBy = hint !== undefined ? `${id}-desc` : undefined;
  const control = (
    <textarea
      id={id}
      aria-describedby={describedBy}
      className={`${FIELD_CLASS} min-h-24 font-mono text-xs leading-relaxed ${className}`}
      {...rest}
    />
  );
  if (label === undefined) return control;
  return (
    <div className="flex flex-col gap-1.5">
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

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
}

export function Checkbox({ label, hint, className = '', ...rest }: CheckboxProps): ReactNode {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        className={`mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border bg-surface-2 accent-[var(--accent)] ${className}`}
        {...rest}
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer text-sm text-text select-none">
          {label}
        </label>
        {hint !== undefined ? <span className="text-xs text-muted/80">{hint}</span> : null}
      </div>
    </div>
  );
}

export { FIELD_CLASS };
