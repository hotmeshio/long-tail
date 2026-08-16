import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { PillMultiSelect } from '../../../components/common/form/PillMultiSelect';
import { SCAN_VERBS, type ScanStep, type ScanVerb } from '../../../api/scan-codes';
import { ScanChoiceEditor } from './ScanChoiceEditor';

export const VERB_LABELS: Record<ScanVerb, string> = {
  [SCAN_VERBS.SHOW_DETAIL]: 'Show the item',
  [SCAN_VERBS.SHOW_LIST]: 'Show all matches as a list',
  [SCAN_VERBS.CLAIM]: 'Claim',
  [SCAN_VERBS.CLAIM_SHOW_DETAIL]: 'Claim and show the item',
  [SCAN_VERBS.RELEASE]: 'Release my claim',
  [SCAN_VERBS.RESOLVE]: 'Resolve with a canned payload',
  [SCAN_VERBS.ESCALATE]: 'Send to another queue',
  [SCAN_VERBS.CANCEL]: 'Cancel',
  [SCAN_VERBS.PRESENT]: 'Show reality + choices',
};

/** One condition/action step: the query, the verb, and the verb's parameters. */
export function StepRow({
  index,
  step,
  roleKeys,
  isLast,
  onPatch,
  onMove,
  onRemove,
}: {
  index: number;
  step: ScanStep;
  roleKeys: string[];
  isLast: boolean;
  onPatch: (patch: Partial<ScanStep>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [payloadText, setPayloadText] = useState(
    step.params?.resolverPayload ? JSON.stringify(step.params.resolverPayload, null, 2) : '',
  );
  const [payloadError, setPayloadError] = useState<string | null>(null);

  const patchQuery = (patch: Partial<ScanStep['query']>) => onPatch({ query: { ...step.query, ...patch } });
  const patchParams = (patch: Partial<NonNullable<ScanStep['params']>>) =>
    onPatch({ params: { ...step.params, ...patch } });

  const onPayloadChange = (text: string) => {
    setPayloadText(text);
    if (!text.trim()) { setPayloadError(null); patchParams({ resolverPayload: undefined }); return; }
    try {
      patchParams({ resolverPayload: JSON.parse(text) });
      setPayloadError(null);
    } catch {
      setPayloadError('Fix the JSON to save this payload.');
    }
  };

  const selectedRoles = step.query.roles ?? [];

  const isPresent = step.verb === SCAN_VERBS.PRESENT;
  const needsTargetRole = step.verb === SCAN_VERBS.ESCALATE;
  const needsPayload = step.verb === SCAN_VERBS.RESOLVE
    || (step.verb === SCAN_VERBS.ESCALATE && step.params?.closeCurrent === 'resolve');

  return (
    <div className="py-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-widest text-text-quaternary">Step {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="icon-link disabled:opacity-30" title="Move up">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={isLast} className="icon-link disabled:opacity-30" title="Move down">
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onRemove} className="icon-link" title="Remove step">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="block">
          <span className="block text-xs text-text-secondary mb-1">Look in</span>
          <span className="block text-2xs text-text-tertiary mb-1">The queues the item is expected in — empty means any.</span>
          <PillMultiSelect
            values={selectedRoles}
            options={roleKeys}
            onChange={(next) => patchQuery({ roles: next.length ? next : undefined })}
            addLabel="Add a queue…"
            emptyText="Any queue I can see"
            ariaLabel="Add a queue"
          />
        </div>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Held by</span>
          <span className="block text-2xs text-text-tertiary mb-1">Narrow to claimed, unclaimed, or my items.</span>
          <select
            value={step.query.availability ?? 'any'}
            onChange={(e) => patchQuery({ availability: e.target.value === 'any' ? undefined : e.target.value as any })}
            className="select"
          >
            <option value="any">Anyone / unheld</option>
            <option value="available">Unclaimed only</option>
            <option value="claimed">Claimed only</option>
            <option value="mine">Mine only</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Then <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">The action this step performs on a match.</span>
          <select
            value={step.verb}
            onChange={(e) => onPatch({ verb: e.target.value as ScanVerb, params: undefined, confirm: undefined, choices: undefined, autoSelectSingle: undefined })}
            className="select"
          >
            {Object.entries(VERB_LABELS).map(([verb, label]) => (
              <option key={verb} value={verb}>{label}</option>
            ))}
          </select>
        </label>
        {needsTargetRole && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Send to <span className="text-status-error">*</span></span>
            <span className="block text-2xs text-text-tertiary mb-1">The queue the item re-homes to.</span>
            <select
              value={step.params?.targetRole ?? ''}
              onChange={(e) => patchParams({ targetRole: e.target.value || undefined })}
              className="select font-mono"
            >
              <option value="" disabled>Choose…</option>
              {roleKeys.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {needsTargetRole && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Current item</span>
            <span className="block text-2xs text-text-tertiary mb-1">Close out the located item first.</span>
            <select
              value={step.params?.closeCurrent ?? ''}
              onChange={(e) => patchParams({ closeCurrent: (e.target.value || undefined) as any })}
              className="select"
            >
              <option value="">Leave it open</option>
              <option value="resolve">Resolve it</option>
              <option value="cancel">Cancel it</option>
            </select>
          </label>
        )}
        {!isPresent && (
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Confirmation</span>
            <span className="block text-2xs text-text-tertiary mb-1">Ask before acting — the prompt shows on the item.</span>
            <input
              value={step.confirm?.prompt ?? ''}
              onChange={(e) => onPatch({ confirm: e.target.value ? { prompt: e.target.value } : undefined })}
              className="input w-full min-w-[16rem]"
              placeholder="Run without asking"
            />
          </label>
        )}
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            checked={!!step.requireActingIdentity}
            onChange={(e) => onPatch({ requireActingIdentity: e.target.checked || undefined })}
          />
          <span className="text-xs text-text-secondary" title="This step runs only for a badged (or write-capable) user.">
            Requires acting identity
          </span>
        </label>
        {isPresent && step.choices?.length === 1 && (
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={!!step.autoSelectSingle}
              onChange={(e) => onPatch({ autoSelectSingle: e.target.checked || undefined })}
            />
            <span className="text-xs text-text-secondary" title="With one choice, the scan runs it directly instead of presenting; a badge is still collected first when required.">
              Auto-select the single choice
            </span>
          </label>
        )}
      </div>

      {needsPayload && (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">
            Resolver payload <span className="text-status-error">*</span>
          </span>
          <span className="block text-2xs text-text-tertiary mb-1">
            JSON submitted as the resolution. {'{scan.target}'}, {'{scan.category}'} and {'{scan.scannedAt}'} fill in from the scan.
          </span>
          <textarea
            value={payloadText}
            onChange={(e) => onPayloadChange(e.target.value)}
            rows={3}
            className="textarea w-full font-mono text-sm"
            placeholder={'{ "outcome": "collected", "serial": "{scan.target}" }'}
          />
          {payloadError && <span className="block text-2xs text-status-error mt-1">{payloadError}</span>}
        </label>
      )}

      {isPresent && (
        <ScanChoiceEditor
          choices={step.choices ?? []}
          onChange={(choices) => onPatch({
            choices: choices.length ? choices : undefined,
            // The knob only means anything for a single-choice present step.
            ...(choices.length === 1 ? {} : { autoSelectSingle: undefined }),
          })}
        />
      )}
    </div>
  );
}
