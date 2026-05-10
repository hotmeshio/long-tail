import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { useGetKnowledge, useDeleteKnowledge, useStoreKnowledge, useSetKnowledgeField, useRemoveKnowledgeField } from '../../api/knowledge';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { TagInput } from '../../components/common/form/TagInput';

interface KnowledgeEntryViewProps {
  domain: string;
  entryKey: string;
  onDeleted: () => void;
}

type EditingCell = { field: string; column: 'field' | 'value' } | null;

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  return JSON.stringify(val, null, 2);
}

function parseValue(raw: string): { value: unknown; looksLikeJson: boolean; parsedOk: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: '', looksLikeJson: false, parsedOk: false };
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  try {
    return { value: JSON.parse(trimmed), looksLikeJson, parsedOk: true };
  } catch {
    return { value: trimmed, looksLikeJson, parsedOk: false };
  }
}

function isSimple(val: unknown): boolean {
  if (typeof val === 'string') {
    const t = val.trim();
    // Strings that look like JSON render as structured
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) return false;
    return true;
  }
  return typeof val === 'number' || typeof val === 'boolean' || val === null;
}

function AutoTextarea({ value, onChange, onKeyDown, placeholder, mono }: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
      ref.current.focus();
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={1}
      className={`w-full bg-transparent text-xs text-text-primary resize-none outline-none p-0 ${mono ? 'font-mono' : ''}`}
      style={{ minHeight: '1.5em' }}
    />
  );
}

export function KnowledgeEntryView({ domain, entryKey, onDeleted }: KnowledgeEntryViewProps) {
  const { data: entry, isLoading, refetch } = useGetKnowledge(domain, entryKey);
  const deleteMutation = useDeleteKnowledge();
  const storeMutation = useStoreKnowledge();
  const setFieldMutation = useSetKnowledgeField();
  const removeFieldMutation = useRemoveKnowledgeField();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [draft, setDraft] = useState('');
  const [ghostField, setGhostField] = useState('');
  const [ghostValue, setGhostValue] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [jsonHint, setJsonHint] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);

  const data = entry?.data as Record<string, unknown> | undefined;
  const allFields = data ? Object.entries(data) : [];

  // Ghost field input doubles as a filter — if text is entered but not yet saved,
  // narrow the visible rows to matching field names
  const fields = useMemo(() => {
    const q = ghostField.trim().toLowerCase();
    if (!q) return allFields;
    return allFields.filter(([field]) => field.toLowerCase().includes(q));
  }, [allFields, ghostField]);

  const originalValue = useCallback((field: string, column: 'field' | 'value'): string => {
    if (column === 'field') return field;
    return formatValue(data?.[field]);
  }, [data]);

  const isDirty = editing
    ? draft !== originalValue(editing.field, editing.column)
    : false;

  function startEdit(field: string, column: 'field' | 'value') {
    setEditing({ field, column });
    setDraft(originalValue(field, column));
    setPendingRemove(null);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }

  function showJsonHint() {
    setJsonHint('Invalid JSON — saved as text');
    setTimeout(() => setJsonHint(null), 4000);
  }

  async function commitEdit() {
    if (!editing || !data) return;
    const { field, column } = editing;

    if (column === 'value') {
      const { value: parsed, looksLikeJson, parsedOk } = parseValue(draft);
      if (looksLikeJson && !parsedOk) showJsonHint();
      // Use setField for surgical update — preserves siblings
      await setFieldMutation.mutateAsync({ domain, key: entryKey, path: field, value: parsed });
    } else {
      // Rename: remove old field, set new field
      const newName = draft.trim();
      if (!newName || newName === field) { cancelEdit(); return; }
      const val = data[field];
      await removeFieldMutation.mutateAsync({ domain, key: entryKey, path: field });
      await setFieldMutation.mutateAsync({ domain, key: entryKey, path: newName, value: val });
    }

    setEditing(null);
    setDraft('');
    refetch();
  }

  async function removeField(field: string) {
    await removeFieldMutation.mutateAsync({ domain, key: entryKey, path: field });
    setPendingRemove(null);
    setEditing(null);
    refetch();
  }

  async function saveTags(tags: string[]) {
    await storeMutation.mutateAsync({
      domain,
      key: entryKey,
      data: data || {},
      tags,
      replace: true,
    });
    refetch();
  }

  async function commitGhostRow() {
    const name = ghostField.trim();
    if (!name) return;
    const { value, looksLikeJson, parsedOk } = parseValue(ghostValue);
    if (looksLikeJson && !parsedOk) showJsonHint();
    const updated = { ...data, [name]: value || '' };
    await storeMutation.mutateAsync({ domain, key: entryKey, data: updated });
    setGhostField('');
    setGhostValue('');
    refetch();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      cancelEdit();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitEdit();
    }
  }

  function handleGhostKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setGhostField('');
      setGhostValue('');
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitGhostRow();
    }
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 mt-4">
        <div className="h-4 bg-surface-sunken rounded w-1/3" />
        <div className="h-48 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!entry || entry.found === false) {
    return <p className="text-sm text-text-tertiary mt-4">Entry not found.</p>;
  }

  return (
    <div>
      {/* Metadata + actions bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4 min-h-[28px]">
          {editingTags ? (
            <div className="flex items-center gap-2">
              <TagInput
                tags={entry.tags || []}
                onChange={(tags) => { saveTags(tags); }}
                placeholder="Add tag..."
                compact
              />
              <button
                onClick={() => setEditingTags(false)}
                className="text-[10px] text-text-tertiary hover:text-text-secondary shrink-0"
              >
                Done
              </button>
            </div>
          ) : (
            <div
              className="flex items-center gap-1 cursor-text group"
              onClick={() => setEditingTags(true)}
              title="Click to edit tags"
            >
              {entry.tags && entry.tags.length > 0 ? (
                entry.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-text-tertiary/40 italic group-hover:text-text-tertiary">add tags...</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-tertiary"><TimeAgo date={entry.updated_at} /></span>
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-[10px]">
              <span className="text-status-error">Delete entry?</span>
              <button
                onClick={async () => {
                  try {
                    await deleteMutation.mutateAsync({ domain, key: entryKey });
                    onDeleted();
                  } catch { /* */ }
                }}
                className="font-medium text-status-error hover:text-status-error/80"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-text-tertiary hover:text-text-secondary"
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-text-tertiary/50 hover:text-status-error transition-colors"
              title="Delete entry"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {jsonHint && (
        <div className="flex items-center justify-end gap-2 mb-2 px-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
          <span className="text-xs text-status-warning">{jsonHint}</span>
        </div>
      )}

      {/* Field/value grid */}
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="text-left text-[10px] uppercase tracking-wider text-text-tertiary border-b border-surface-border">
            <th className="px-3 py-2 font-medium w-[200px] border-r border-surface-border">Field</th>
            <th className="px-3 py-2 font-medium">Value</th>
          </tr>
          {/* Input row — add new field or filter existing */}
          <tr className="border-b border-surface-border bg-surface">
            <td className="px-3 py-2 align-top border-r border-surface-border">
              <input
                value={ghostField}
                onChange={(e) => setGhostField(e.target.value)}
                onKeyDown={handleGhostKeyDown}
                placeholder={allFields.length ? 'add or filter...' : 'new field'}
                className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-tertiary/40 placeholder:italic outline-none p-0"
              />
            </td>
            <td className="px-3 py-2 align-top">
              <AutoTextarea
                value={ghostValue}
                onChange={setGhostValue}
                onKeyDown={handleGhostKeyDown}
                placeholder="value"
              />
              {ghostField.trim() && (
                <div className="flex gap-2 mt-1.5">
                  <button
                    onClick={commitGhostRow}
                    className="text-[10px] font-medium text-accent hover:text-accent-hover"
                    disabled={storeMutation.isPending}
                  >
                    {storeMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setGhostField(''); setGhostValue(''); }}
                    className="text-[10px] text-text-tertiary hover:text-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </td>
          </tr>
        </thead>
        <tbody>
          {fields.map(([field, value]) => {
            const isEditingField = editing?.field === field && editing.column === 'field';
            const isEditingValue = editing?.field === field && editing.column === 'value';
            const isActive = isEditingField || isEditingValue;
            const isRemoving = pendingRemove === field;

            return (
              <tr key={field} className={`border-b border-surface-border ${isRemoving ? 'bg-status-error/10' : isActive ? '' : 'hover:bg-surface-hover/30'}`}>
                {/* Field name cell */}
                <td
                  className={`px-3 py-2 align-top border-r cursor-text ${isRemoving ? 'bg-transparent border-r-transparent' : isEditingField ? 'border-r-surface-border bg-accent/5 border-l-2 border-l-accent' : 'border-r-surface-border'}`}
                  onClick={() => !isEditingField && !isRemoving && startEdit(field, 'field')}
                >
                  {isEditingField ? (
                    <div>
                      <AutoTextarea value={draft} onChange={setDraft} onKeyDown={handleKeyDown} placeholder="field name" />
                      {isDirty && (
                        <div className="flex gap-2 mt-1.5">
                          <button onClick={commitEdit} className="text-[10px] font-medium text-accent hover:text-accent-hover" disabled={storeMutation.isPending}>
                            {storeMutation.isPending ? 'Saving...' : 'Save'}
                          </button>
                          <button onClick={cancelEdit} className="text-[10px] text-text-tertiary hover:text-text-secondary">Cancel</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-text-secondary break-all">{field}</span>
                  )}
                </td>

                {/* Value cell */}
                <td
                  className={`px-3 py-2 align-top cursor-text ${isRemoving ? 'bg-transparent' : isEditingValue ? 'bg-accent/5 border-l-2 border-l-accent' : ''}`}
                  onClick={() => !isEditingValue && !isRemoving && startEdit(field, 'value')}
                >
                  {isRemoving ? (
                    <span className="flex items-center justify-end gap-2 text-[10px]">
                      <span className="text-status-error">Remove <span className="font-medium">{field}</span>?</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeField(field); }}
                        className="font-medium text-status-error hover:text-status-error/80"
                        disabled={storeMutation.isPending}
                      >
                        {storeMutation.isPending ? '...' : 'Yes'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPendingRemove(null); }}
                        className="text-text-tertiary hover:text-text-secondary"
                      >
                        No
                      </button>
                    </span>
                  ) : isEditingValue ? (
                    <div>
                      <AutoTextarea
                        value={draft}
                        onChange={setDraft}
                        onKeyDown={handleKeyDown}
                        placeholder="value (string or JSON)"
                        mono={!isSimple(value)}
                      />
                      <div className="flex gap-2 mt-1.5">
                        {isDirty && (
                          <button onClick={commitEdit} className="text-[10px] font-medium text-accent hover:text-accent-hover" disabled={storeMutation.isPending}>
                            {storeMutation.isPending ? 'Saving...' : 'Save'}
                          </button>
                        )}
                        <button onClick={cancelEdit} className="text-[10px] text-text-tertiary hover:text-text-secondary">Cancel</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setPendingRemove(field); }}
                          className="text-[10px] text-status-error/50 hover:text-status-error ml-auto"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    isSimple(value) ? (
                      <p className="text-xs text-text-primary break-words whitespace-pre-wrap">{String(value)}</p>
                    ) : (
                      <pre className="text-xs text-text-primary font-mono whitespace-pre-wrap break-words">
                        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                      </pre>
                    )
                  )}
                </td>
              </tr>
            );
          })}

        </tbody>
      </table>
    </div>
  );
}
