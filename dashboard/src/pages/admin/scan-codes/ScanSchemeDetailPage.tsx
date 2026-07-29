import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ScanBarcode, SlidersHorizontal, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useScanScheme, useUpsertScanScheme, useDeleteScanScheme, type ScanRule } from '../../../api/scan-codes';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { ScanRuleEditor } from './ScanRuleEditor';

/** The first free single-digit category (0-9), or null when all are taken. */
function nextCategory(used: Set<string>): string | null {
  for (let c = 0; c <= 9; c++) if (!used.has(String(c))) return String(c);
  return null;
}

function SectionGroup({
  icon: Icon,
  label,
  annotation,
  aside,
  children,
}: {
  icon: React.ElementType;
  label: string;
  annotation?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-3 h-3 text-text-tertiary shrink-0" strokeWidth={1.5} />
          <span className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">{label}</span>
          {annotation && <span className="text-2xs text-text-quaternary truncate">— {annotation}</span>}
        </div>
        {aside}
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
  const nextCat = nextCategory(new Set(rules.map((r) => r.category)));

  const sampleTarget = scheme.encoding === 'fixed' ? '7'.repeat(scheme.target_length ?? 8) : 'SN-1234';
  const codeFor = (category: string) =>
    scheme.encoding === 'fixed'
      ? `${scheme.version}${category}${sampleTarget}`
      : `${scheme.version}${scheme.delimiter}${category}${scheme.delimiter}${sampleTarget}`;

  return (
    <div className="space-y-10">
      <PageHeader title={scheme.name} />

      <p className="text-sm text-text-secondary max-w-form -mt-4">
        Codes for this scheme start with <span className="font-mono text-text-primary">{scheme.version}</span>.
        Add an action, name it, and configure what a scan does — each action gets its own
        slot automatically.
      </p>

      <SchemeSettings key={scheme.version} scheme={scheme} ruleCount={rules.length} />

      <SectionGroup
        icon={ListChecks}
        label="Actions"
        annotation="what a scan of this scheme does — named, in the order you add them"
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

function SchemeSettings({ scheme, ruleCount }: { scheme: { version: number; name: string; description: string | null; target_facet: string; encoding: 'fixed' | 'delimited'; delimiter: string; target_length: number | null; enabled: boolean }; ruleCount: number }) {
  const navigate = useNavigate();
  const upsert = useUpsertScanScheme();
  const remove = useDeleteScanScheme();
  const [name, setName] = useState(scheme.name);
  const [targetFacet, setTargetFacet] = useState(scheme.target_facet);
  const [enabled, setEnabled] = useState(scheme.enabled);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const dirty = name !== scheme.name || targetFacet !== scheme.target_facet || enabled !== scheme.enabled;

  return (
    <SectionGroup
      icon={SlidersHorizontal}
      label="Scheme"
      annotation={`version digit ${scheme.version}`}
      aside={(
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-1 text-xs text-status-error/80 hover:text-status-error"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete scheme
        </button>
      )}
    >
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

      <ConfirmDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => remove.mutate(scheme.version, {
          onSuccess: () => navigate('/admin/scan-codes'),
        })}
        title={`Delete scheme ${scheme.version}`}
        description={
          ruleCount > 0
            ? `This deletes "${scheme.name}" and its ${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}. Codes starting with ${scheme.version} stop resolving, and labels already printed with them report unconfigured.`
            : `This deletes "${scheme.name}". Codes starting with ${scheme.version} stop resolving.`
        }
        isPending={remove.isPending}
        error={remove.error as Error | null}
      />
    </SectionGroup>
  );
}
