import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ScanBarcode, SlidersHorizontal, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useScanScheme, useUpsertScanScheme, useDeleteScanScheme, SCAN_SCHEME_KINDS, type ScanRule, type ScanScheme, type ScanSchemeKind } from '../../../api/scan-codes';
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

function SchemeSettings({ scheme, ruleCount }: { scheme: ScanScheme; ruleCount: number }) {
  const navigate = useNavigate();
  const upsert = useUpsertScanScheme();
  const remove = useDeleteScanScheme();
  const [name, setName] = useState(scheme.name);
  const [kind, setKind] = useState<ScanSchemeKind>(scheme.kind);
  const [targetFacet, setTargetFacet] = useState(scheme.target_facet);
  const [grantTtlSeconds, setGrantTtlSeconds] = useState(scheme.grant_ttl_seconds ?? 3600);
  const [grantMaxUses, setGrantMaxUses] = useState(scheme.grant_max_uses ?? 0);
  const [enabled, setEnabled] = useState(scheme.enabled);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isIdentity = kind === SCAN_SCHEME_KINDS.IDENTITY;
  const ttlValid = !isIdentity || (grantTtlSeconds >= 1 && grantTtlSeconds <= 86_400);
  const dirty = name !== scheme.name
    || targetFacet !== scheme.target_facet
    || enabled !== scheme.enabled
    || kind !== scheme.kind
    || (isIdentity && (grantTtlSeconds !== scheme.grant_ttl_seconds || grantMaxUses !== scheme.grant_max_uses));

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
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Kind <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">
            {isIdentity ? 'A badge — scanning it primes who acts next.' : 'An item code — scanning it acts on the item.'}
          </span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ScanSchemeKind)} className="select">
            <option value={SCAN_SCHEME_KINDS.ACTION}>Action</option>
            <option value={SCAN_SCHEME_KINDS.IDENTITY}>Identity</option>
          </select>
        </label>
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Name <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">
            {isIdentity ? 'Say who the badge identifies.' : 'Say what the target identifies.'}
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
        </label>
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">Target facet <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">
            {isIdentity
              ? 'The user-metadata key the badge matches (e.g. badge_id).'
              : 'The metadata key the scanned value matches.'}
          </span>
          <input value={targetFacet} onChange={(e) => setTargetFacet(e.target.value)} className="input w-full font-mono" />
        </label>
        {isIdentity && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Grant TTL (seconds) <span className="text-status-error">*</span></span>
            <span className="block text-2xs text-text-tertiary mb-1">How long a badge scan stays primed (1–86400).</span>
            <input
              type="number" min={1} max={86400}
              value={grantTtlSeconds}
              onChange={(e) => setGrantTtlSeconds(Number(e.target.value))}
              className="input w-[12rem]"
            />
            {!ttlValid && <span className="block text-2xs text-status-error mt-1">Enter 1–86400 seconds.</span>}
          </label>
        )}
        {isIdentity && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Grant max uses</span>
            <span className="block text-2xs text-text-tertiary mb-1">0 = TTL-bound; n = the grant covers n scans.</span>
            <input
              type="number" min={0}
              value={grantMaxUses}
              onChange={(e) => setGrantMaxUses(Number(e.target.value))}
              className="input w-[12rem]"
            />
          </label>
        )}
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
            disabled={upsert.isPending || !name || !targetFacet || !ttlValid}
            onClick={() => upsert.mutate({
              version: scheme.version,
              name,
              description: scheme.description,
              target_facet: targetFacet,
              encoding: scheme.encoding,
              delimiter: scheme.delimiter,
              target_length: scheme.target_length,
              kind,
              grant_ttl_seconds: isIdentity ? grantTtlSeconds : null,
              grant_max_uses: isIdentity ? grantMaxUses : 0,
              enabled,
            })}
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
