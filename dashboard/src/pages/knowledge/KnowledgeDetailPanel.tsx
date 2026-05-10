import { useState } from 'react';
import { X, Trash2, Plus, Pencil, Check, XCircle } from 'lucide-react';
import { useGetKnowledge, useDeleteKnowledge, useStoreKnowledge } from '../../api/knowledge';
import { TimeAgo } from '../../components/common/display/TimeAgo';

interface KnowledgeDetailPanelProps {
  domain: string;
  entryKey: string;
  onClose: () => void;
  onDeleted?: () => void;
}

export function KnowledgeDetailPanel({ domain, entryKey, onClose, onDeleted }: KnowledgeDetailPanelProps) {
  const { data: entry, isLoading, refetch } = useGetKnowledge(domain, entryKey);
  const deleteMutation = useDeleteKnowledge();
  const storeMutation = useStoreKnowledge();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteField, setDeleteField] = useState<string | null>(null);
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addMode, setAddMode] = useState(false);
  const [newField, setNewField] = useState('');
  const [newValue, setNewValue] = useState('');

  const data = entry?.data as Record<string, unknown> | undefined;
  const fields = data ? Object.entries(data) : [];

  function formatValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    return JSON.stringify(val, null, 2);
  }

  function parseValue(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  }

  function isSimple(val: unknown): boolean {
    return typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null;
  }

  async function saveField(field: string, value: unknown) {
    await storeMutation.mutateAsync({
      domain,
      key: entryKey,
      data: { ...data, [field]: value },
    });
    refetch();
  }

  async function removeField(field: string) {
    const updated = { ...data };
    delete updated[field];
    await storeMutation.mutateAsync({ domain, key: entryKey, data: updated });
    setDeleteField(null);
    refetch();
  }

  return (
    <div className="w-[380px] shrink-0 border-l border-surface-border bg-surface overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-surface z-10 px-5 pt-5 pb-3 border-b border-surface-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary truncate pr-2" title={entryKey}>
            {entryKey}
          </h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => { setAddMode(true); setNewField(''); setNewValue(''); }}
            className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs"
            title="Add field"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Field</span>
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs text-status-error/70 hover:text-status-error"
            title="Delete entry"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>

        {/* Delete entry confirmation */}
        {confirmDelete && (
          <div className="mt-3 p-3 bg-status-error/5 border border-status-error/20 rounded-md">
            <p className="text-xs text-text-primary mb-2">
              Permanently delete <span className="font-medium">{entryKey}</span>? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="btn-secondary text-xs" disabled={deleteMutation.isPending}>Cancel</button>
              <button
                onClick={async () => {
                  try {
                    await deleteMutation.mutateAsync({ domain, key: entryKey });
                    setConfirmDelete(false);
                    onDeleted?.();
                  } catch { /* shown below */ }
                }}
                className="btn-primary text-xs !bg-status-error hover:!bg-status-error/90"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-status-error mt-2">{deleteMutation.error.message}</p>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-surface-sunken rounded w-2/3" />
            <div className="h-4 bg-surface-sunken rounded w-1/2" />
            <div className="h-48 bg-surface-sunken rounded" />
          </div>
        ) : entry && entry.found !== false ? (
          <>
            {/* Metadata row */}
            <div className="flex items-center gap-4 mb-4 text-[10px] text-text-tertiary uppercase tracking-wider">
              <span>{domain}</span>
              <span className="text-surface-border">|</span>
              <span><TimeAgo date={entry.updated_at} /></span>
            </div>

            {entry.tags && entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-4">
                {entry.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Add field form */}
            {addMode && (
              <div className="mb-4 p-3 bg-surface-sunken rounded-md border border-surface-border">
                <input
                  value={newField}
                  onChange={(e) => setNewField(e.target.value)}
                  placeholder="Field name"
                  className="input text-xs w-full mb-2"
                  autoFocus
                />
                <textarea
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="Value (string or JSON)"
                  className="input text-xs w-full mb-2 font-mono"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button onClick={() => setAddMode(false)} className="btn-secondary text-xs">Cancel</button>
                  <button
                    onClick={async () => {
                      if (!newField.trim()) return;
                      await saveField(newField.trim(), parseValue(newValue));
                      setAddMode(false);
                    }}
                    className="btn-primary text-xs"
                    disabled={!newField.trim() || storeMutation.isPending}
                  >
                    {storeMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {/* Field/value table */}
            <div className="border border-surface-border rounded-md overflow-hidden">
              {fields.length === 0 ? (
                <p className="text-xs text-text-tertiary p-4 text-center">No fields</p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {fields.map(([field, value]) => (
                      <tr key={field} className="border-b border-surface-border last:border-b-0 group">
                        {/* Field name */}
                        <td className="px-3 py-2.5 align-top w-[120px] bg-surface-sunken/50">
                          <span className="text-[11px] font-medium text-text-secondary break-all">{field}</span>
                        </td>
                        {/* Value */}
                        <td className="px-3 py-2.5 align-top">
                          {editField === field ? (
                            <div>
                              <textarea
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="input text-xs w-full font-mono mb-2"
                                rows={isSimple(value) ? 2 : 5}
                                autoFocus
                              />
                              <div className="flex gap-1">
                                <button
                                  onClick={async () => {
                                    await saveField(field, parseValue(editValue));
                                    setEditField(null);
                                  }}
                                  className="text-status-success hover:text-status-success/80"
                                  title="Save"
                                  disabled={storeMutation.isPending}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditField(null)}
                                  className="text-text-tertiary hover:text-text-secondary"
                                  title="Cancel"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                {isSimple(value) ? (
                                  <p className="text-xs text-text-primary break-words whitespace-pre-wrap">{String(value)}</p>
                                ) : (
                                  <pre className="text-[11px] text-text-primary font-mono whitespace-pre-wrap break-words bg-surface-sunken rounded p-2 max-h-[200px] overflow-y-auto">
                                    {JSON.stringify(value, null, 2)}
                                  </pre>
                                )}
                              </div>
                              {/* Hover actions */}
                              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5">
                                <button
                                  onClick={() => { setEditField(field); setEditValue(formatValue(value)); }}
                                  className="text-text-tertiary hover:text-accent p-0.5"
                                  title="Edit"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => setDeleteField(field)}
                                  className="text-text-tertiary hover:text-status-error p-0.5"
                                  title="Delete field"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Delete field confirmation */}
                          {deleteField === field && (
                            <div className="mt-2 p-2 bg-status-error/5 border border-status-error/20 rounded text-xs">
                              <p className="text-text-primary mb-1.5">Remove <span className="font-medium">{field}</span>?</p>
                              <div className="flex gap-2">
                                <button onClick={() => setDeleteField(null)} className="btn-secondary text-xs !py-0.5 !px-2">Cancel</button>
                                <button
                                  onClick={() => removeField(field)}
                                  className="btn-primary text-xs !py-0.5 !px-2 !bg-status-error hover:!bg-status-error/90"
                                  disabled={storeMutation.isPending}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-text-tertiary">Entry not found.</p>
        )}
      </div>
    </div>
  );
}
