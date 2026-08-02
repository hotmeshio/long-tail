import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  SCAN_VERBS,
  SCAN_SCHEME_KINDS,
  useUpsertScanRule,
  useDeleteScanRule,
  type ScanRule,
  type ScanSchemeKind,
  type ScanStep,
} from '../../../api/scan-codes';
import { useRoleDetails } from '../../../api/roles';
import { StepRow } from './StepRow';

const newStep = (): ScanStep => ({ query: {}, verb: SCAN_VERBS.SHOW_DETAIL });

/**
 * The 1-2-3 rule editor. 1 — name the rule (the label printed beside the
 * physical code). 2 — order the condition queries; the first that matches
 * wins. 3 — each step's action, plus the fallback when nothing matches and
 * the notPrimed screen when a badge is required. Identity-kind schemes never
 * walk steps, so their editor collapses to name + the unknown-badge message.
 */
export function ScanRuleEditor({
  schemeVersion,
  schemeKind,
  category,
  rule,
  codePreview,
  onDeleted,
}: {
  schemeVersion: number;
  schemeKind: ScanSchemeKind;
  category: string;
  rule: ScanRule | null;
  codePreview: string;
  onDeleted: () => void;
}) {
  const upsert = useUpsertScanRule();
  const remove = useDeleteScanRule();
  const { data: roles } = useRoleDetails();
  const roleKeys = (roles?.roles ?? []).map((r) => r.role);
  const isIdentity = schemeKind === SCAN_SCHEME_KINDS.IDENTITY;

  const [name, setName] = useState(rule?.name ?? '');
  const [steps, setSteps] = useState<ScanStep[]>(rule?.steps ?? (isIdentity ? [] : [newStep()]));
  const [fallbackMarkdown, setFallbackMarkdown] = useState(rule?.fallback?.markdown ?? '');
  const [notPrimedMarkdown, setNotPrimedMarkdown] = useState(rule?.notPrimed?.markdown ?? '');
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
      steps: isIdentity ? [] : steps,
      fallback: { markdown: fallbackMarkdown || undefined },
      notPrimed: { markdown: notPrimedMarkdown || undefined },
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
            {isIdentity ? 'Name the badge population — "Associate badge".' : 'Print this beside the code — "Send Printer to Servicing".'}
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

      {/* 2+3 — Condition steps, each with its action. Identity schemes mint a
          grant instead of walking steps, so the section stays out entirely. */}
      {!isIdentity && (
        <>
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
        </>
      )}

      {/* Fallback + notPrimed screens */}
      <div className="flex flex-wrap gap-4">
        <label className="block flex-1 min-w-[16rem]">
          <span className="block text-xs text-text-secondary mb-1">
            {isIdentity ? '2 · When the badge is unknown' : '3 · When nothing matches'}
          </span>
          <span className="block text-2xs text-text-tertiary mb-1">
            {isIdentity
              ? 'Markdown shown when a scanned badge matches no user.'
              : 'Markdown shown to the scanner operator when no step finds the item.'}
          </span>
          <textarea
            value={fallbackMarkdown}
            onChange={(e) => setFallbackMarkdown(e.target.value)}
            rows={3}
            className="textarea w-full font-mono text-sm"
            placeholder={isIdentity
              ? '**Badge not recognized.** See your lead to get it registered.'
              : '**Nothing here.** The item this code points at is not in any queue.'}
          />
        </label>
        {!isIdentity && (
          <label className="block flex-1 min-w-[16rem]">
            <span className="block text-xs text-text-secondary mb-1">When a badge is required</span>
            <span className="block text-2xs text-text-tertiary mb-1">
              Markdown shown when a step or choice needs an acting identity and none is primed.
            </span>
            <textarea
              value={notPrimedMarkdown}
              onChange={(e) => setNotPrimedMarkdown(e.target.value)}
              rows={3}
              className="textarea w-full font-mono text-sm"
              placeholder={'**Scan your badge** to run this action.'}
            />
          </label>
        )}
      </div>

      {upsert.error && <p className="text-xs text-status-error">{(upsert.error as Error).message}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!name || (!isIdentity && steps.length === 0) || upsert.isPending}
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
