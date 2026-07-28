import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  SCAN_VERBS,
  useUpsertScanRule,
  useDeleteScanRule,
  type ScanRule,
  type ScanStep,
  type ScanVerb,
} from '../../../api/scan-codes';
import { useRoleDetails } from '../../../api/roles';

const VERB_LABELS: Record<ScanVerb, string> = {
  [SCAN_VERBS.SHOW_DETAIL]: 'Show the item',
  [SCAN_VERBS.SHOW_LIST]: 'Show all matches as a list',
  [SCAN_VERBS.CLAIM]: 'Claim',
  [SCAN_VERBS.CLAIM_SHOW_DETAIL]: 'Claim and show the item',
  [SCAN_VERBS.RELEASE]: 'Release my claim',
  [SCAN_VERBS.RESOLVE]: 'Resolve with a canned payload',
  [SCAN_VERBS.ESCALATE]: 'Send to another queue',
  [SCAN_VERBS.CANCEL]: 'Cancel',
};

const newStep = (): ScanStep => ({ query: {}, verb: SCAN_VERBS.SHOW_DETAIL });

/**
 * The 1-2-3 rule editor. 1 — name the rule (the label printed beside the
 * physical code). 2 — order the condition queries; the first that matches
 * wins. 3 — each step's action, plus the fallback when nothing matches.
 */
export function ScanRuleEditor({
  schemeVersion,
  category,
  rule,
  codePreview,
  onDeleted,
}: {
  schemeVersion: number;
  category: string;
  rule: ScanRule | null;
  codePreview: string;
  onDeleted: () => void;
}) {
  const upsert = useUpsertScanRule();
  const remove = useDeleteScanRule();
  const { data: roles } = useRoleDetails();
  const roleKeys = (roles?.roles ?? []).map((r) => r.role);

  const [name, setName] = useState(rule?.name ?? '');
  const [steps, setSteps] = useState<ScanStep[]>(rule?.steps ?? [newStep()]);
  const [fallbackMarkdown, setFallbackMarkdown] = useState(rule?.fallback?.markdown ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const patchStep = (i: number, patch: Partial<ScanStep>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));

  const save = () =>
    upsert.mutate({
      scheme_version: schemeVersion,
      category,
      name,
      steps,
      fallback: { markdown: fallbackMarkdown || undefined },
      enabled,
    });

  return (
    <div className="space-y-8 max-w-form">
      {/* 1 — Identity */}
      <div className="flex flex-wrap items-end gap-4">
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">
            1 · Friendly name <span className="text-status-error">*</span>
          </span>
          <span className="block text-2xs text-text-tertiary mb-1">
            Print this beside the code — "Send Printer to Servicing".
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Status</span>
          <span className="block text-2xs text-text-tertiary mb-1">Disabled rules report unconfigured.</span>
          <select value={enabled ? 'enabled' : 'disabled'} onChange={(e) => setEnabled(e.target.value === 'enabled')} className="select">
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      </div>

      {/* 2+3 — Condition steps, each with its action */}
      <div className="space-y-1">
        <span className="block text-xs text-text-secondary">
          2 · Conditions and actions <span className="text-status-error">*</span>
        </span>
        <span className="block text-2xs text-text-tertiary">
          Scanning walks the steps in order — the first query that finds the item runs its
          action. Put the expected state first and a broad "show the item" last so a
          misplaced item still reports where it is.
        </span>
      </div>
      <div className="divide-y divide-surface-border border-y border-surface-border">
        {steps.map((step, i) => (
          <StepRow
            key={i}
            index={i}
            step={step}
            roleKeys={roleKeys}
            isLast={i === steps.length - 1}
            onPatch={(patch) => patchStep(i, patch)}
            onMove={(dir) => moveStep(i, dir)}
            onRemove={() => removeStep(i)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setSteps((prev) => [...prev, newStep()])}
        className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover"
      >
        <Plus className="w-3.5 h-3.5" /> Add a step
      </button>

      {/* Fallback */}
      <label className="block">
        <span className="block text-xs text-text-secondary mb-1">3 · When nothing matches</span>
        <span className="block text-2xs text-text-tertiary mb-1">
          Markdown shown to the scanner operator when no step finds the item.
        </span>
        <textarea
          value={fallbackMarkdown}
          onChange={(e) => setFallbackMarkdown(e.target.value)}
          rows={3}
          className="textarea w-full font-mono text-sm"
          placeholder={'**Nothing here.** The item this code points at is not in any queue.'}
        />
      </label>

      {upsert.error && <p className="text-xs text-status-error">{(upsert.error as Error).message}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!name || steps.length === 0 || upsert.isPending}
          className="btn-primary text-xs"
        >
          {rule ? 'Save rule' : `Create rule ${schemeVersion}:${category}`}
        </button>
        <span className="text-2xs text-text-quaternary font-mono">{codePreview}</span>
        {rule && (
          <button
            type="button"
            onClick={() => remove.mutate({ scheme_version: schemeVersion, category }, { onSuccess: onDeleted })}
            className="ml-auto flex items-center gap-1 text-xs text-status-error/80 hover:text-status-error"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete rule
          </button>
        )}
      </div>
    </div>
  );
}

function StepRow({
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
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Look in <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">The queue the item is expected in.</span>
          <select
            value={step.query.roles?.[0] ?? ''}
            onChange={(e) => patchQuery({ roles: e.target.value ? [e.target.value] : undefined })}
            className="select font-mono"
          >
            <option value="">Any queue I can see</option>
            {roleKeys.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
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
            onChange={(e) => onPatch({ verb: e.target.value as ScanVerb, params: undefined, confirm: undefined })}
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
    </div>
  );
}
