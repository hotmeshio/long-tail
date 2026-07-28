import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanBarcode, Plus } from 'lucide-react';
import { useScanSchemes, useUpsertScanScheme, type ScanScheme } from '../../../api/scan-codes';
import { useRoleDetails } from '../../../api/roles';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { CodeShape } from './CodeShape';

/**
 * Scan schemes — the nine version slots. A scheme declares what the leading
 * digit of a scanned code means: which escalation metadata facet the target
 * resolves against and how the string parses. Categories (the rules) live
 * on the scheme's detail page.
 */
export function ScanCodesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useScanSchemes();
  const [creating, setCreating] = useState<number | null>(null);

  const byVersion = new Map<number, ScanScheme>();
  for (const s of data?.schemes ?? []) byVersion.set(s.version, s);

  const openSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => !byVersion.has(v));

  return (
    <div>
      <PageHeader title="Scan Codes" />
      <p className="text-sm text-text-secondary max-w-form mb-8">
        Scan codes are organized into 3 parts: <CodeShape highlight="version" />.
        Pick a single-digit <span className="font-semibold text-text-primary">version</span> to begin (1-9).
      </p>

      {isLoading ? (
        <div className="text-sm text-text-tertiary">Loading…</div>
      ) : (
        <div className="divide-y divide-surface-border border-y border-surface-border max-w-form">
          {(data?.schemes ?? []).map((scheme) => (
            <div
              key={scheme.version}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/admin/scan-codes/${scheme.version}`)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/admin/scan-codes/${scheme.version}`); }}
              className="flex items-center gap-4 py-3 px-2 cursor-pointer hover:bg-surface-sunken transition-colors"
            >
              <span className="w-8 h-8 flex items-center justify-center text-sm font-mono text-accent border border-surface-border rounded shrink-0">
                {scheme.version}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{scheme.name}</div>
                <div className="text-2xs text-text-tertiary truncate">
                  target facet <span className="font-mono">{scheme.target_facet}</span>
                  {' · '}{scheme.encoding === 'fixed'
                    ? `fixed, ${scheme.target_length} digit target`
                    : `delimited by "${scheme.delimiter}"`}
                </div>
              </div>
              <span className={`text-2xs uppercase tracking-widest ${scheme.enabled ? 'text-status-success' : 'text-text-quaternary'}`}>
                {scheme.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          ))}
          {openSlots.length > 0 && (
            <div className="flex items-center gap-4 py-3 px-2">
              <span className="w-8 h-8 flex items-center justify-center text-text-quaternary shrink-0">
                <ScanBarcode className="w-4 h-4" strokeWidth={1.5} />
              </span>
              {creating === null ? (
                <button
                  type="button"
                  onClick={() => setCreating(openSlots[0])}
                  className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover"
                >
                  <Plus className="w-3.5 h-3.5" /> Define a scheme
                  <span className="text-text-quaternary text-2xs">
                    — versions {openSlots.join(', ')} open
                  </span>
                </button>
              ) : (
                <NewSchemeForm
                  openSlots={openSlots}
                  initialVersion={creating}
                  onDone={(version) => {
                    setCreating(null);
                    if (version != null) navigate(`/admin/scan-codes/${version}`);
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewSchemeForm({
  openSlots,
  initialVersion,
  onDone,
}: {
  openSlots: number[];
  initialVersion: number;
  onDone: (version: number | null) => void;
}) {
  const upsert = useUpsertScanScheme();
  const { data: roles } = useRoleDetails();
  const [version, setVersion] = useState(initialVersion);
  const [name, setName] = useState('');
  const [targetFacet, setTargetFacet] = useState('');
  const [encoding, setEncoding] = useState<'' | 'fixed' | 'delimited'>('');
  const [targetLength, setTargetLength] = useState(8);

  const priorityFacets = Array.from(
    new Set((roles?.roles ?? []).map((r) => r.priority_facet).filter(Boolean) as string[]),
  );

  const submit = async () => {
    if (!name || !targetFacet || !encoding) return;
    await upsert.mutateAsync({
      version,
      name,
      target_facet: targetFacet,
      encoding,
      target_length: encoding === 'fixed' ? targetLength : null,
    });
    onDone(version);
  };

  return (
    <div className="flex-1 space-y-3">
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Version <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">The code's leading digit.</span>
          <select value={version} onChange={(e) => setVersion(Number(e.target.value))} className="select">
            {openSlots.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Name <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">Say what the target identifies — "Printer serial".</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="Printer serial" />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Target facet <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">The escalation metadata key the scanned value matches.</span>
          <input
            value={targetFacet}
            onChange={(e) => setTargetFacet(e.target.value)}
            className="input w-full font-mono"
            placeholder="serialNumber"
            list="scan-facet-suggestions"
          />
          <datalist id="scan-facet-suggestions">
            {priorityFacets.map((f) => <option key={f} value={f} />)}
          </datalist>
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Encoding <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">Pick fixed for numeric UPC labels, delimited for QR/Code 128.</span>
          <select value={encoding} onChange={(e) => setEncoding(e.target.value as any)} className="select">
            <option value="" disabled>Choose…</option>
            <option value="fixed">Fixed digits (UPC)</option>
            <option value="delimited">Delimited text (QR / Code 128)</option>
          </select>
        </label>
        {encoding === 'fixed' && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Target digits <span className="text-status-error">*</span></span>
            <span className="block text-2xs text-text-tertiary mb-1">How many digits the target occupies.</span>
            <input
              type="number" min={1} max={20}
              value={targetLength}
              onChange={(e) => setTargetLength(Number(e.target.value))}
              className="input w-[12rem]"
            />
          </label>
        )}
      </div>
      {upsert.error && <p className="text-xs text-status-error">{(upsert.error as Error).message}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={() => onDone(null)} className="btn-secondary text-xs">Discard</button>
        <button
          type="button"
          onClick={submit}
          disabled={!name || !targetFacet || !encoding || upsert.isPending}
          className="btn-primary text-xs"
        >
          Create scheme
        </button>
      </div>
    </div>
  );
}
