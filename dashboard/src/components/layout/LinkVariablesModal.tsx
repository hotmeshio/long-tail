import { Modal } from '../common/modal/Modal';
import { useLinkVariables } from '../../hooks/useLinkVariables';

/**
 * Per-device bindings for the member's role-declared link variables. One row
 * per variable: the facet name, its declaring role, and a free-text value.
 * Writes are live (localStorage, this device only) — templated pins across
 * the dashboard re-render with the new binding immediately. An empty value
 * clears the binding: templated links then fall back to the role's declared
 * default, or drop the facet entirely (no filter).
 */
export function LinkVariablesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { declarations, values, setValue } = useLinkVariables();

  return (
    <Modal open={open} onClose={onClose} title="Link Variables" maxWidth="max-w-lg">
      <p className="text-2xs text-text-tertiary leading-relaxed mb-4">
        Values bound on this device. Pinned links that reference a variable
        open with its value applied; an unbound variable falls back to the
        role's default, or applies no filter at all.
      </p>
      <div className="divide-y divide-surface-border">
        {declarations.map((d, i) => {
          const bound = values[d.name] ?? '';
          return (
            <div key={d.name} className="py-3 flex items-center gap-3" data-testid="link-var-row">
              <div className="w-40 shrink-0 min-w-0">
                <p className="text-xs font-mono text-text-primary truncate" title={d.name}>{d.name}</p>
                <p className="text-2xs text-text-quaternary truncate" title={`declared by ${d.fromRole}`}>
                  {d.label ?? d.fromRole}
                </p>
              </div>
              <input
                type="text"
                autoFocus={i === 0}
                value={bound}
                onChange={(e) => setValue(d.name, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onClose(); }}
                placeholder={d.default ? `${d.default} (default)` : 'no filter'}
                aria-label={`Value for ${d.name}`}
                className="input text-xs font-mono flex-1 min-w-0"
              />
              <button
                onClick={() => setValue(d.name, null)}
                disabled={bound === ''}
                title={`Clear ${d.name}`}
                className="p-1 text-text-quaternary hover:text-status-error transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                &times;
              </button>
            </div>
          );
        })}
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
