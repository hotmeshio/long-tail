import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanBarcode, Plus } from 'lucide-react';
import { useScanSchemes, useUpsertScanScheme } from '../../../api/scan-codes';
import { useRoleDetails } from '../../../api/roles';
import { PageHeader } from '../../../components/common/layout/PageHeader';

/** The first free two-digit scheme index (10-99), or null when all are taken. */
function nextSchemeVersion(used: Set<number>): number | null {
  for (let v = 10; v <= 99; v++) if (!used.has(v)) return v;
  return null;
}

/**
 * Scan schemes — the named things a scanned code addresses. Each scheme owns a
 * two-digit index (assigned automatically, starting at 10) and declares which
 * escalation metadata facet the scanned target resolves against and how the
 * string parses. Its rules live on the scheme's detail page. Operators name
 * schemes; the index is a printing detail, never something to pick.
 */
export function ScanCodesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useScanSchemes();
  const [creating, setCreating] = useState(false);

  const schemes = data?.schemes ?? [];
  const used = new Set(schemes.map((s) => s.version));
  const next = nextSchemeVersion(used);

  return (
    <div>
      <PageHeader title="Scan Codes" />
      <p className="text-sm text-text-secondary max-w-form mb-8">
        A scan code addresses one of your escalations by a value on its label. Add a
        scheme, name it, and point it at the metadata facet the scanned value matches —
        then define what each scan does on its detail page.
      </p>

      {isLoading ? (
        <div className="text-sm text-text-tertiary">Loading…</div>
      ) : (
        <div className="divide-y divide-surface-border border-y border-surface-border max-w-form">
          {schemes.map((scheme) => (
            <div
              key={scheme.version}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/admin/scan-codes/${scheme.version}`)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/admin/scan-codes/${scheme.version}`); }}
              className="flex items-center gap-4 py-3 px-2 cursor-pointer hover:bg-surface-sunken transition-colors"
            >
              <span className="w-9 h-8 flex items-center justify-center text-sm font-mono text-accent border border-surface-border rounded shrink-0">
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
          <div className="flex items-center gap-4 py-3 px-2">
            <span className="w-9 h-8 flex items-center justify-center text-text-quaternary shrink-0">
              <ScanBarcode className="w-4 h-4" strokeWidth={1.5} />
            </span>
            {next == null ? (
              <span className="text-2xs text-text-quaternary">All 90 scheme slots are in use.</span>
            ) : !creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover"
              >
                <Plus className="w-3.5 h-3.5" /> Add a scheme
              </button>
            ) : (
              <NewSchemeForm
                version={next}
                onDone={(version) => {
                  setCreating(false);
                  if (version != null) navigate(`/admin/scan-codes/${version}`);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewSchemeForm({
  version,
  onDone,
}: {
  version: number;
  onDone: (version: number | null) => void;
}) {
  const upsert = useUpsertScanScheme();
  const { data: roles } = useRoleDetails();
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
      <p className="text-2xs text-text-tertiary">
        Codes for this scheme start with <span className="font-mono text-text-secondary">{version}</span> — assigned for you.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Name <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">Say what the target identifies — "Printer serial".</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="Printer serial" autoFocus />
        </label>
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
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Code style <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">Delimited for QR / Code 128, fixed digits for numeric UPC labels.</span>
          <select value={encoding} onChange={(e) => setEncoding(e.target.value as any)} className="select">
            <option value="" disabled>Choose…</option>
            <option value="delimited">Delimited text (QR / Code 128)</option>
            <option value="fixed">Fixed digits (UPC)</option>
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
