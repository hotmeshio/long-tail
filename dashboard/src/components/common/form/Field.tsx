import { useId, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/**
 * Canonical form primitives. Every authored page composes its forms from these
 * so labels, fields, hints, and errors look identical everywhere — and so a
 * single override of the `.input` / `.select` / `.textarea` classes (or the
 * theme tokens they read) restyles the whole product at once. Do not hand-roll
 * `<input className="border ...">`; reach for these.
 */

interface FieldShellProps {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error, wired for accessibility. The message renders
 *  at `${htmlFor}-msg` so controls can point aria-describedby at it. */
export function Field({ label, required, hint, error, htmlFor, className = '', children }: FieldShellProps) {
  const msgId = htmlFor ? `${htmlFor}-msg` : undefined;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required && <span className="text-status-error ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={msgId} className="text-[10px] text-status-error mt-1" role="alert">{error}</p>
      ) : hint ? (
        <p id={msgId} className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

type BaseProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Extra classes on the wrapping Field, not the control. */
  fieldClassName?: string;
};

function describedBy(id: string, hint: ReactNode, error: ReactNode): string | undefined {
  return error || hint ? `${id}-msg` : undefined;
}

export function TextField({
  label, hint, error, required, fieldClassName, id, className = '', ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={fieldId} className={fieldClassName}>
      <input
        id={fieldId}
        className={`input ${className}`}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      />
    </Field>
  );
}

interface SelectFieldProps extends BaseProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectField({
  label, hint, error, required, fieldClassName, id, className = '', options, placeholder, ...rest
}: SelectFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={fieldId} className={fieldClassName}>
      <select
        id={fieldId}
        className={`select ${className}`}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function TextArea({
  label, hint, error, required, fieldClassName, id, className = '', ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={fieldId} className={fieldClassName}>
      <textarea
        id={fieldId}
        className={`textarea ${className}`}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      />
    </Field>
  );
}
