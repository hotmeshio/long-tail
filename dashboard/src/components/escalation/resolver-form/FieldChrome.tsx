/**
 * Shared field chrome for the resolver form: label, helper, error, and the
 * input class recipes. One place styles every generated field.
 */

export function FieldLabel({ children, isRequired, htmlFor }: {
  children: React.ReactNode;
  isRequired?: boolean;
  htmlFor?: string;
}) {
  // `block` is load-bearing: a <label> is inline by default, and the
  // label→instruction→control anatomy would then hold only by accident —
  // a full-width control wraps below, but a narrow control (number,
  // max-w-48) with no instruction line sits flush BESIDE the label. The
  // anatomy is a column; the label declares it.
  return (
    <label htmlFor={htmlFor} className="block text-2xs font-semibold uppercase tracking-wider text-text-secondary">
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

// Select shares the field recipe but adds the unified chevron (via .select).
// Width follows the content, floored for presence and capped by the cell —
// a one-word choice never stretches across the measure. The floor is
// min(16rem, 100%): CSS lets min-width beat max-width, so a bare min-w-64
// would overflow a cell narrower than 16rem — the cell always wins.
export function selectClass(hasError?: boolean): string {
  return hasError
    ? 'select text-sm mt-1 min-w-[min(16rem,100%)] max-w-full border-status-error/50 focus:border-status-error animate-[field-shake_0.4s_ease-in-out]'
    : 'select text-sm mt-1 min-w-[min(16rem,100%)] max-w-full';
}
