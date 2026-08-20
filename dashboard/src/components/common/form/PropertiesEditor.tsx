import { useState } from 'react';
import { KeyRound } from 'lucide-react';

/** One atomic patch: deleting is explicit, an absent key means keep. */
export interface PropertyOps {
  set?: Record<string, unknown>;
  remove?: string[];
  rename?: Record<string, string>;
}

/**
 * A generic key/value dictionary editor that emits ATOMIC patch ops — it
 * never round-trips the whole dictionary, so editing one property can never
 * clobber another. Dictionary-agnostic by design: the owner wires `onPatch`
 * to whichever properties surface it manages (user properties today; any
 * dictionary with a patch endpoint tomorrow).
 *
 * - Add / edit value / rename key / delete (with confirm), one op at a time.
 * - Values JSON-parse with a string fallback, so numbers, booleans, and
 *   objects round-trip typed.
 * - `systemKeys` are marked (the platform reads them — e.g. badge scheme
 *   facets) and their edits sit behind a confirm step.
 */
export function PropertiesEditor({ value, systemKeys = [], pending = false, error, onPatch }: {
  value: Record<string, unknown> | null | undefined;
  systemKeys?: string[];
  pending?: boolean;
  /** The owner's last patch error (e.g. a 409 identity conflict), shown inline. */
  error?: string | null;
  onPatch: (ops: PropertyOps) => void;
}) {
  const entries = Object.entries(value ?? {});
  const systemSet = new Set(systemKeys);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [confirmSystem, setConfirmSystem] = useState<string | null>(null);
  const [ghostName, setGhostName] = useState('');
  const [ghostValue, setGhostValue] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const format = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const parse = (raw: string): unknown => {
    const trimmed = raw.trim();
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  };

  function startEdit(key: string) {
    if (systemSet.has(key) && confirmSystem !== key) {
      setConfirmSystem(key);
      return;
    }
    setConfirmSystem(null);
    setEditingKey(key);
    setDraftName(key);
    setDraftValue(format((value ?? {})[key]));
    setPendingRemove(null);
    setInlineError(null);
  }

  function commitEdit() {
    if (editingKey === null) return;
    const name = draftName.trim();
    if (!name) { setInlineError('Property name is required'); return; }
    if (name !== editingKey && entries.some(([k]) => k === name)) {
      setInlineError(`"${name}" already exists`);
      return;
    }
    const ops: PropertyOps = {};
    if (name !== editingKey) ops.rename = { [editingKey]: name };
    const nextValue = parse(draftValue);
    if (format(nextValue) !== format((value ?? {})[editingKey]) || name !== editingKey) {
      // A renamed key keeps its value unless the value also changed; a value
      // change lands under the (possibly new) name — one atomic patch.
      if (format(nextValue) !== format((value ?? {})[editingKey])) {
        ops.set = { [name]: nextValue };
      }
    }
    if (!ops.set && !ops.rename) { cancelEdit(); return; }
    onPatch(ops);
    cancelEdit();
  }

  function cancelEdit() {
    setEditingKey(null);
    setDraftName('');
    setDraftValue('');
    setInlineError(null);
  }

  function commitAdd() {
    const name = ghostName.trim();
    if (!name) { setInlineError('Property name is required'); return; }
    if (entries.some(([k]) => k === name)) {
      setInlineError(`"${name}" already exists`);
      return;
    }
    onPatch({ set: { [name]: parse(ghostValue) } });
    setGhostName('');
    setGhostValue('');
    setInlineError(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
        Properties
      </p>

      {entries.length === 0 && (
        <p className="text-xs text-text-tertiary italic">No properties — add one below.</p>
      )}

      {entries.map(([key, val]) => {
        const isSystem = systemSet.has(key);
        const isEditing = editingKey === key;
        const isRemoving = pendingRemove === key;
        return (
          <div key={key} className="group text-xs">
            {isEditing ? (
              <div className="space-y-1.5 border-l-2 border-l-accent pl-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  aria-label="Property name"
                  className="input text-xs w-full min-w-0 font-mono"
                />
                <input
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  aria-label="Property value"
                  placeholder="value (string or JSON)"
                  className="input text-xs w-full min-w-0"
                />
                <div className="flex gap-2">
                  <button onClick={commitEdit} disabled={pending} className="text-2xs font-medium text-accent hover:text-accent-hover">
                    {pending ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={cancelEdit} className="text-2xs text-text-tertiary hover:text-text-secondary">Cancel</button>
                  <button
                    onClick={() => { setPendingRemove(key); setEditingKey(null); }}
                    className="text-2xs text-status-error/50 hover:text-status-error ml-auto"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : isRemoving ? (
              <span className="flex items-center gap-2 text-2xs">
                <span className="text-status-error">Remove <span className="font-medium font-mono">{key}</span>?</span>
                <button
                  onClick={() => { onPatch({ remove: [key] }); setPendingRemove(null); }}
                  disabled={pending}
                  className="font-medium text-status-error hover:text-status-error/80"
                >
                  {pending ? '...' : 'Yes'}
                </button>
                <button onClick={() => setPendingRemove(null)} className="text-text-tertiary hover:text-text-secondary">No</button>
              </span>
            ) : confirmSystem === key ? (
              <span className="flex items-center gap-2 text-2xs">
                <span className="text-text-secondary">
                  <span className="font-mono font-medium">{key}</span> is a system property — the platform resolves identities with it. Edit?
                </span>
                <button onClick={() => startEdit(key)} className="font-medium text-accent hover:text-accent-hover">Edit</button>
                <button onClick={() => setConfirmSystem(null)} className="text-text-tertiary hover:text-text-secondary">Cancel</button>
              </span>
            ) : (
              <button
                onClick={() => startEdit(key)}
                className="flex items-center gap-2 w-full min-w-0 text-left rounded px-1 py-0.5 -mx-1 hover:bg-surface-hover transition-colors"
                title={`Edit ${key}`}
              >
                <span className="font-mono font-medium text-text-secondary shrink-0">{key}</span>
                {isSystem && (
                  <span className="shrink-0 text-accent/80" title="system">
                    <KeyRound className="w-3 h-3" aria-label="system" />
                  </span>
                )}
                {/* Value right-aligns so the section reads tabular. */}
                <span className="flex-1 min-w-0 truncate text-right text-text-primary tabular-nums">{format(val)}</span>
              </button>
            )}
          </div>
        );
      })}

      {/* Add row */}
      <div className="pt-1.5 border-t border-surface-border space-y-1.5">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={ghostName}
            onChange={(e) => setGhostName(e.target.value)}
            placeholder="property"
            aria-label="New property name"
            className="input text-xs w-full min-w-0 font-mono"
          />
          <input
            value={ghostValue}
            onChange={(e) => setGhostValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitAdd(); }}
            placeholder="value"
            aria-label="New property value"
            className="input text-xs w-full min-w-0"
          />
        </div>
        {ghostName.trim() && (
          <div className="flex justify-end">
            <button onClick={commitAdd} disabled={pending} className="btn-primary text-xs">
              {pending ? '...' : 'Add Property'}
            </button>
          </div>
        )}
      </div>

      {(inlineError || error) && (
        <p role="alert" className="text-2xs text-status-error">{inlineError || error}</p>
      )}
    </div>
  );
}
