/**
 * Shared field chrome for the resolver form: label, helper, error, and the
 * input class recipes. One place styles every generated field.
 */

export function FieldLabel({ children, isRequired, htmlFor }: {
  children: React.ReactNode;
  isRequired?: boolean;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="text-2xs font-semibold uppercase tracking-wider text-text-secondary">
      {children}
      {isRequired && <span className="text-status-error ml-0.5">*</span>}
    </label>
  );
}

export function FieldHelper({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-2xs text-text-tertiary mt-0.5 leading-snug">
      {children}
    </p>
  );
}

export function FieldError({ error, id }: { error?: string; id?: string }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="text-2xs text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]">
      {error}
    </p>
  );
}

export function inputClass(hasError?: boolean): string {
  return hasError
    ? 'input text-sm w-full mt-1 border-status-error/50 focus:border-status-error animate-[field-shake_0.4s_ease-in-out]'
    : 'input text-sm w-full mt-1';
}

// Select shares the field recipe but adds the unified chevron (via .select), so
// generated dropdowns match every other select in the product.
export function selectClass(hasError?: boolean): string {
  return hasError
    ? 'select text-sm w-full mt-1 border-status-error/50 focus:border-status-error animate-[field-shake_0.4s_ease-in-out]'
    : 'select text-sm w-full mt-1';
}
