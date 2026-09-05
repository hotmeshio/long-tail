import { useId } from 'react';
import { Modal } from '../common/modal/Modal';
import { useLinkVariables, type DeclaredLinkVariable } from '../../hooks/useLinkVariables';
import { useFacetValues } from '../../api/escalations';

/**
 * Per-device bindings for the member's role-declared link variables. One row
 * per variable: the facet name, its declaring role, and a value. Writes are
 * live (localStorage, this device only) — templated pins and the Pace Board
 * scope re-render with the new binding immediately. An empty value clears the
 * binding: templated links then fall back to the role's declared default, or
 * drop the facet entirely (no filter).
 */
export function LinkVariablesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { declarations, values, setValue } = useLinkVariables();

  return (
    <Modal open={open} onClose={onClose} title="Link Variables" maxWidth="max-w-lg">
      <p className="text-2xs text-text-tertiary leading-relaxed mb-4">
        Values bound on this device. Pinned links and the Pace Board open scoped
        to the value applied; an unbound variable falls back to the role's
        default, or applies no filter at all.
      </p>
      <div className="divide-y divide-surface-border">
        {declarations.map((d, i) => (
          <LinkVarRow
            key={d.name}
            declaration={d}
            value={values[d.name] ?? ''}
            autoFocus={i === 0}
            onChange={(v) => setValue(d.name, v)}
            onClear={() => setValue(d.name, null)}
            onEnter={onClose}
          />
        ))}
      </div>
      {declarations.length === 0 && (
        <p className="text-xs text-text-tertiary">Your roles declare no link variables.</p>
      )}
      {declarations.length > 0 && (
        <div className="flex justify-end pt-4">
          {/* Writes are live — OK confirms what's already bound and closes. */}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors"
          >
            OK
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * One binding row. The value input is backed by a datalist of the facet's
 * actual distinct values (role-scoped) — the operator picks north/south rather
 * than typing, while free text stays allowed for values not yet in the data.
 */
function LinkVarRow({
  declaration,
  value,
  autoFocus,
  onChange,
  onClear,
  onEnter,
}: {
  declaration: DeclaredLinkVariable;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onEnter: () => void;
}) {
  const listId = useId();
  const { data } = useFacetValues(declaration.name);
  const options = data?.values ?? [];

  return (
    <div className="py-3 flex items-center gap-3" data-testid="link-var-row">
      <div className="w-40 shrink-0 min-w-0">
        <p className="text-xs font-mono text-text-primary truncate" title={declaration.name}>{declaration.name}</p>
        <p className="text-2xs text-text-quaternary truncate" title={`declared by ${declaration.fromRole}`}>
          {declaration.label ?? declaration.fromRole}
        </p>
      </div>
      <input
        type="text"
        list={listId}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
        placeholder={declaration.default ? `${declaration.default} (default)` : 'no filter'}
        aria-label={`Value for ${declaration.name}`}
        className="input text-xs font-mono flex-1 min-w-0"
      />
      <datalist id={listId}>
        {options.map((v) => <option key={v} value={v} />)}
      </datalist>
      <button
        onClick={onClear}
        disabled={value === ''}
        title={`Clear ${declaration.name}`}
        className="p-1 text-text-quaternary hover:text-status-error transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
      >
        &times;
      </button>
    </div>
  );
}
