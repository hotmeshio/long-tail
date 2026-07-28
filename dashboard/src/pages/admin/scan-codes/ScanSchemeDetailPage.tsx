import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ScanBarcode, SlidersHorizontal, Grid3X3 } from 'lucide-react';
import { useScanScheme, useUpsertScanScheme, type ScanRule } from '../../../api/scan-codes';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { ScanRuleEditor } from './ScanRuleEditor';

const CATEGORIES = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));

function SectionGroup({
  icon: Icon,
  label,
  annotation,
  children,
}: {
  icon: React.ElementType;
  label: string;
  annotation?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-5 min-w-0">
        <Icon className="w-3 h-3 text-text-tertiary shrink-0" strokeWidth={1.5} />
        <span className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">{label}</span>
        {annotation && <span className="text-2xs text-text-quaternary truncate">— {annotation}</span>}
      </div>
      <div className="border-l-2 pl-5 border-surface-border/60">{children}</div>
    </div>
  );
}

/**
 * One scheme's rules. The category grid selects a two-digit slot; the rule
 * editor beneath walks the 1-2-3: name the rule, order its condition
 * queries, and set each step's action and the no-match fallback.
 */
export function ScanSchemeDetailPage() {
  const { version: versionParam } = useParams<{ version: string }>();
  const version = Number(versionParam);
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading } = useScanScheme(Number.isInteger(version) ? version : null);

  const selected = searchParams.get('category');
  const selectCategory = (category: string | null) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (category) p.set('category', category); else p.delete('category');
      return p;
    });
  };

  if (isLoading) return <div className="text-sm text-text-tertiary">Loading…</div>;
  if (!data) return <div className="text-sm text-text-tertiary">No scheme for version {versionParam}.</div>;

  const { scheme, rules } = data;
  const ruleByCategory = new Map<string, ScanRule>(rules.map((r) => [r.category, r]));
  const selectedRule = selected ? ruleByCategory.get(selected) ?? null : null;

  const sampleTarget = scheme.encoding === 'fixed' ? '7'.repeat(scheme.target_length ?? 8) : 'SN-1234';
  const codeFor = (category: string) =>
    scheme.encoding === 'fixed'
      ? `${scheme.version}${category}${sampleTarget}`
      : `${scheme.version}${scheme.delimiter}${category}${scheme.delimiter}${sampleTarget}`;

  return (
    <div className="space-y-10">
      <PageHeader title={scheme.name} />

      <SchemeSettings key={scheme.version} scheme={scheme} />

      <SectionGroup
        icon={Grid3X3}
        label="Categories"
        annotation="pick a two-digit slot to define what scanning it does"
      >
        <div className="grid grid-cols-10 gap-1 max-w-form">
          {CATEGORIES.map((category) => {
            const configured = ruleByCategory.has(category);
            const isSelected = selected === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => selectCategory(isSelected ? null : category)}
                title={configured ? ruleByCategory.get(category)!.name : `Define ${category}`}
                className={`h-8 text-xs font-mono rounded-sm border transition-colors ${
                  isSelected
                    ? 'border-accent bg-accent/10 text-accent'
                    : configured
                      ? 'border-accent/30 text-accent hover:border-accent'
                      : 'border-surface-border text-text-quaternary hover:text-text-secondary hover:border-surface-border/80'
                }`}
              >
                {category}
              </button>
            );
          })}
        </div>
      </SectionGroup>

      {selected && (
        <SectionGroup
          icon={ScanBarcode}
          label={`Rule ${scheme.version}:${selected}`}
          annotation={`a label like this prints beside the code — e.g. ${codeFor(selected)}`}
        >
          <ScanRuleEditor
            key={`${scheme.version}:${selected}`}
            schemeVersion={scheme.version}
            category={selected}
            rule={selectedRule}
            codePreview={codeFor(selected)}
            onDeleted={() => selectCategory(null)}
          />
        </SectionGroup>
      )}
    </div>
  );
}

function SchemeSettings({ scheme }: { scheme: { version: number; name: string; description: string | null; target_facet: string; encoding: 'fixed' | 'delimited'; delimiter: string; target_length: number | null; enabled: boolean } }) {
  const upsert = useUpsertScanScheme();
  const [name, setName] = useState(scheme.name);
  const [targetFacet, setTargetFacet] = useState(scheme.target_facet);
  const [enabled, setEnabled] = useState(scheme.enabled);

  const dirty = name !== scheme.name || targetFacet !== scheme.target_facet || enabled !== scheme.enabled;

  return (
    <SectionGroup icon={SlidersHorizontal} label="Scheme" annotation={`version digit ${scheme.version}`}>
      <div className="flex flex-wrap items-end gap-4 max-w-form">
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Name <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">Say what the target identifies.</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
        </label>
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Target facet <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">The metadata key the scanned value matches.</span>
          <input value={targetFacet} onChange={(e) => setTargetFacet(e.target.value)} className="input w-full font-mono" />
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Status</span>
          <span className="block text-2xs text-text-tertiary mb-1">Disable to reject every scan of this version.</span>
          <select value={enabled ? 'enabled' : 'disabled'} onChange={(e) => setEnabled(e.target.value === 'enabled')} className="select">
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        {dirty && (
          <button
            type="button"
            disabled={upsert.isPending || !name || !targetFacet}
            onClick={() => upsert.mutate({
              version: scheme.version,
              name,
              description: scheme.description,
              target_facet: targetFacet,
              encoding: scheme.encoding,
              delimiter: scheme.delimiter,
              target_length: scheme.target_length,
              enabled,
            } as any)}
            className="btn-primary text-xs"
          >
            Save
          </button>
        )}
      </div>
      {upsert.error && <p className="text-xs text-status-error mt-2">{(upsert.error as Error).message}</p>}
    </SectionGroup>
  );
}
