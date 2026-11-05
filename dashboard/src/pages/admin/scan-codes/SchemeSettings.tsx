import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { useUpsertScanScheme, useDeleteScanScheme, SCAN_SCHEME_KINDS, type ScanScheme, type ScanSchemeKind } from '../../../api/scan-codes';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { GrantScopeField } from './GrantScopeField';
import { SchemeMatchFields, patternLines, patternsValid, type TargetMatch } from './SchemeMatchFields';
import { SectionGroup } from './SectionGroup';

/** The scheme's own settings: kind, name, target facet, grant policy, match, status. */
export function SchemeSettings({ scheme, ruleCount }: { scheme: ScanScheme; ruleCount: number }) {
  const navigate = useNavigate();
  const upsert = useUpsertScanScheme();
  const remove = useDeleteScanScheme();
  const [name, setName] = useState(scheme.name);
  const [kind, setKind] = useState<ScanSchemeKind>(scheme.kind);
  const [targetFacet, setTargetFacet] = useState(scheme.target_facet);
  const [grantTtlSeconds, setGrantTtlSeconds] = useState(scheme.grant_ttl_seconds ?? 3600);
  const [grantMaxUses, setGrantMaxUses] = useState(scheme.grant_max_uses ?? 0);
  const [grantScope, setGrantScope] = useState<'action' | 'subject'>(scheme.grant_scope ?? 'action');
  const [enabled, setEnabled] = useState(scheme.enabled);
  const [targetMatch, setTargetMatch] = useState<TargetMatch>(scheme.target_match ?? 'value');
  const [patternsText, setPatternsText] = useState((scheme.patterns ?? []).join('\n'));
  const [precedesGtin, setPrecedesGtin] = useState<boolean | null>(scheme.precedes_gtin ?? null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isIdentity = kind === SCAN_SCHEME_KINDS.IDENTITY;
  const ttlValid = !isIdentity || (grantTtlSeconds >= 1 && grantTtlSeconds <= 86_400);
  const isPattern = scheme.encoding === 'pattern';
  const fieldsValid = !isPattern || patternsValid(patternsText);
  const dirty = name !== scheme.name
    || targetMatch !== (scheme.target_match ?? 'value')
    || patternLines(patternsText).join('\n') !== (scheme.patterns ?? []).join('\n')
    || precedesGtin !== (scheme.precedes_gtin ?? null)
    || targetFacet !== scheme.target_facet
    || enabled !== scheme.enabled
    || kind !== scheme.kind
    || (isIdentity && (grantTtlSeconds !== scheme.grant_ttl_seconds || grantMaxUses !== scheme.grant_max_uses
      || grantScope !== (scheme.grant_scope ?? 'action')));

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
            <span className="block text-2xs text-text-tertiary mb-1">0 = TTL-bound; n = the grant covers n acts.</span>
            <input
              type="number" min={0}
              value={grantMaxUses}
              onChange={(e) => setGrantMaxUses(Number(e.target.value))}
              className="input w-[12rem]"
            />
          </label>
        )}
        {isIdentity && <GrantScopeField value={grantScope} onChange={setGrantScope} />}
        <SchemeMatchFields
          encoding={scheme.encoding}
          isIdentity={isIdentity}
          targetMatch={targetMatch}
          onTargetMatch={setTargetMatch}
          patternsText={patternsText}
          onPatternsText={setPatternsText}
          precedesGtin={precedesGtin}
          onPrecedesGtin={setPrecedesGtin}
        />
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
            disabled={upsert.isPending || !name || !targetFacet || !ttlValid || !fieldsValid}
            onClick={() => upsert.mutate({
              version: scheme.version,
              name,
              description: scheme.description,
              target_facet: targetFacet,
              encoding: scheme.encoding,
              delimiter: scheme.delimiter,
              target_length: scheme.target_length,
              patterns: isPattern ? patternLines(patternsText) : [],
              precedes_gtin: isPattern ? precedesGtin : null,
              target_match: isIdentity ? 'value' : targetMatch,
              kind,
              grant_ttl_seconds: isIdentity ? grantTtlSeconds : null,
              grant_max_uses: isIdentity ? grantMaxUses : 0,
              grant_scope: isIdentity ? grantScope : 'action',
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
