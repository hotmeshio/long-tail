import { useParams, useSearchParams } from 'react-router-dom';
import { ScanBarcode, ListChecks, Plus } from 'lucide-react';
import { useScanScheme, SCAN_SCHEME_KINDS, type ScanRule } from '../../../api/scan-codes';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { ScanRuleEditor } from './ScanRuleEditor';
import { SchemeSettings } from './SchemeSettings';
import { SectionGroup } from './SectionGroup';

/** The first free single-digit category (0-9), or null when all are taken. */
function nextCategory(used: Set<string>): string | null {
  for (let c = 0; c <= 9; c++) if (!used.has(String(c))) return String(c);
  return null;
}

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
  const nextCat = nextCategory(new Set(rules.map((r) => r.category)));

  const sampleTarget = scheme.encoding === 'fixed' ? '7'.repeat(scheme.target_length ?? 8) : 'SN-1234';
  const codeFor = (category: string) =>
    scheme.encoding === 'gtin'
      ? '036000291452'
      : scheme.encoding === 'pattern'
        ? scheme.patterns[0] ?? ''
        : scheme.encoding === 'fixed'
        ? `${scheme.version}${category}${sampleTarget}`
        : `${scheme.version}${scheme.delimiter}${category}${scheme.delimiter}${sampleTarget}`;

  return (
    <div className="space-y-10">
      <PageHeader title={scheme.name} />

      <p className="text-sm text-text-secondary max-w-form -mt-4">
        {scheme.encoding === 'gtin' || scheme.encoding === 'pattern'
          ? 'Codes for this scheme carry no prefix; the code itself is the target.'
          : <>Codes for this scheme start with <span className="font-mono text-text-primary">{scheme.version}</span>.</>}
        {scheme.kind === SCAN_SCHEME_KINDS.IDENTITY
          ? ' Scanning a badge primes who acts next; each slot names the badge and its unknown-badge message.'
          : ' Add an action, name it, and configure what a scan does — each action gets its own slot automatically.'}
      </p>

      <SchemeSettings key={scheme.version} scheme={scheme} ruleCount={rules.length} />

      <SectionGroup
        icon={ListChecks}
        label="Actions"
        annotation={scheme.kind === SCAN_SCHEME_KINDS.IDENTITY
          ? 'named badge slots — each carries its unknown-badge message'
          : 'what a scan of this scheme does — named, in the order you add them'}
      >
        <div className="divide-y divide-surface-border border-y border-surface-border max-w-form">
          {rules.map((rule) => {
            const isSelected = selected === rule.category;
            return (
              <button
                key={rule.category}
                type="button"
                onClick={() => selectCategory(isSelected ? null : rule.category)}
                className={`w-full flex items-center gap-4 py-3 px-2 text-left transition-colors ${
                  isSelected ? 'bg-accent/10' : 'hover:bg-surface-sunken'
                }`}
              >
                <span className="w-9 h-8 flex items-center justify-center text-xs font-mono text-accent border border-surface-border rounded shrink-0">
                  {rule.category}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{rule.name}</div>
                  <div className="text-2xs text-text-tertiary font-mono truncate">{codeFor(rule.category)}</div>
                </div>
              </button>
            );
          })}
          <div className="flex items-center gap-4 py-3 px-2">
            <span className="w-9 h-8 flex items-center justify-center text-text-quaternary shrink-0">
              <ScanBarcode className="w-4 h-4" strokeWidth={1.5} />
            </span>
            {nextCat == null ? (
              <span className="text-2xs text-text-quaternary">All 10 action slots are in use.</span>
            ) : (
              <button
                type="button"
                onClick={() => selectCategory(nextCat)}
                className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover"
              >
                <Plus className="w-3.5 h-3.5" /> Add an action
              </button>
            )}
          </div>
        </div>
      </SectionGroup>

      {selected && (
        <SectionGroup
          icon={ScanBarcode}
          label={selectedRule ? selectedRule.name : 'New action'}
          annotation={`this label prints beside the code — e.g. ${codeFor(selected)}`}
        >
          <ScanRuleEditor
            key={`${scheme.version}:${selected}`}
            schemeVersion={scheme.version}
            schemeKind={scheme.kind}
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
