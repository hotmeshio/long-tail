import type { SchemeIdentifier } from '../../../api/scan-codes';

/** The binders field's text: role names, comma separated. */
export function bindersText(identifier: SchemeIdentifier | null | undefined): string {
  return (identifier?.binders ?? []).join(', ');
}

/** The settings a save sends; null when nothing is set. */
export function identifierOf(binders: string, exclusiveTarget: boolean): SchemeIdentifier | null {
  const roles = binders.split(',').map((r) => r.trim()).filter(Boolean);
  if (!roles.length && !exclusiveTarget) return null;
  return { ...(roles.length ? { binders: roles } : {}), ...(exclusiveTarget ? { exclusiveTarget: true } : {}) };
}

/** Who may bind an action scheme's values to targets, and how many values a target holds. */
export function SchemeBindingFields({
  binders,
  onBinders,
  exclusiveTarget,
  onExclusiveTarget,
}: {
  binders: string;
  onBinders: (value: string) => void;
  exclusiveTarget: boolean;
  onExclusiveTarget: (value: boolean) => void;
}) {
  return (
    <>
      <label className="block flex-1 min-w-[16rem]">
        <span className="block text-xs text-text-secondary mb-1">Binders</span>
        <span className="block text-2xs text-text-tertiary mb-1">List the roles that bind values to targets, besides role managers.</span>
        <input value={binders} onChange={(e) => onBinders(e.target.value)} placeholder="loader, print-servicer" className="input w-full font-mono" />
      </label>
      <label className="block">
        <span className="block text-xs text-text-secondary mb-1">Values per target</span>
        <span className="block text-2xs text-text-tertiary mb-1">
          {exclusiveTarget ? 'A new bind retires the target\'s old value.' : 'A target holds any number of values.'}
        </span>
        <select value={exclusiveTarget ? 'one' : 'many'} onChange={(e) => onExclusiveTarget(e.target.value === 'one')} className="select">
          <option value="many">Many</option>
          <option value="one">One</option>
        </select>
      </label>
    </>
  );
}
