import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useStoreKnowledge, useListDomains } from '../../api/knowledge';

interface CreateEntryModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (domain: string, key: string) => void;
  /** Pre-fill data from a dropped JSON file */
  prefillData?: Record<string, unknown>;
  /** Pre-fill domain from current navigation */
  prefillDomain?: string;
}

export function CreateEntryModal({ open, onClose, onCreated, prefillData, prefillDomain }: CreateEntryModalProps) {
  const { data: domainsData } = useListDomains();
  const storeMutation = useStoreKnowledge();
  const [domain, setDomain] = useState(prefillDomain || '');
  const [key, setKey] = useState('');
  const [dataInput, setDataInput] = useState(prefillData ? JSON.stringify(prefillData, null, 2) : '{}');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');

  const domains = (domainsData?.domains ?? []).map((d: any) => d.domain);

  // Sync prefill props → state when they change (e.g., JSON drop)
  useEffect(() => {
    if (open) {
      setDataInput(prefillData ? JSON.stringify(prefillData, null, 2) : '{}');
      setDomain(prefillDomain || '');
      setKey('');
      setTags('');
      setError('');
    }
  }, [open, prefillData, prefillDomain]);

  if (!open) return null;

  const handleSubmit = async () => {
    setError('');
    if (!domain.trim()) { setError('Domain is required'); return; }
    if (!key.trim()) { setError('Key is required'); return; }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataInput);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    } catch {
      setError('Data must be a valid JSON object');
      return;
    }
    try {
      await storeMutation.mutateAsync({
        domain: domain.trim(),
        key: key.trim(),
        data: parsed,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      });
      onCreated?.(domain.trim(), key.trim());
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6 overflow-y-auto">
        <div className="bg-surface-raised border border-surface-border rounded-lg shadow-lg w-full max-w-md max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
            <h3 className="text-sm font-medium text-text-primary">New Knowledge Entry</h3>
            <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
            {/* Domain */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Domain</label>
              <input
                type="text"
                list="domain-list"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g., screenshots, config, emails"
                className="input text-xs w-full"
              />
              <datalist id="domain-list">
                {domains.map((d: string) => <option key={d} value={d} />)}
              </datalist>
            </div>

            {/* Key */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Key</label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g., homepage, user-profile, report-2026"
                className="input text-xs w-full"
              />
            </div>

            {/* Data */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Data (JSON)</label>
              <textarea
                value={dataInput}
                onChange={(e) => setDataInput(e.target.value)}
                rows={8}
                className="input font-mono text-[11px] w-full max-h-[30vh] resize-y"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g., important, review, 401k"
                className="input text-xs w-full"
              />
            </div>

            {error && <p className="text-xs text-status-error">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border">
            <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={storeMutation.isPending}
              className="btn-primary text-xs"
            >
              {storeMutation.isPending ? 'Creating...' : 'Create Entry'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
