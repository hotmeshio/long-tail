import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SCAN_VERBS, type ScanChoice, type ScanVerb } from '../../../api/scan-codes';

/** Choice verbs are the escalation primitives — presenting inside a presentation is out. */
const CHOICE_VERBS: ScanVerb[] = [
  SCAN_VERBS.SHOW_DETAIL,
  SCAN_VERBS.CLAIM,
  SCAN_VERBS.CLAIM_SHOW_DETAIL,
  SCAN_VERBS.RELEASE,
  SCAN_VERBS.RESOLVE,
  SCAN_VERBS.ESCALATE,
  SCAN_VERBS.CANCEL,
];

const newChoice = (): ScanChoice => ({ label: '', verb: SCAN_VERBS.RESOLVE });

/**
 * The labeled choice set a PRESENT step offers. Each row is one button on the
 * station screen: its label, the verb it runs, an optional double-scan code,
 * whether it needs a badge, an ask-first prompt, and the verb's params as JSON.
 */
export function ScanChoiceEditor({
  choices,
  onChange,
}: {
  choices: ScanChoice[];
  onChange: (choices: ScanChoice[]) => void;
}) {
  const patchChoice = (i: number, patch: Partial<ScanChoice>) =>
    onChange(choices.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeChoice = (i: number) => onChange(choices.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-1">
      <span className="block text-xs text-text-secondary">
        Choices <span className="text-status-error">*</span>
      </span>
      <span className="block text-2xs text-text-tertiary">
        The buttons the station screen offers under the item's reality. A code makes a
        choice double-scannable — scan the item, then the printed action card.
      </span>
      <div className="divide-y divide-surface-border border-y border-surface-border">
        {choices.map((choice, i) => (
          <ChoiceRow
            key={i}
            index={i}
            choice={choice}
            onPatch={(patch) => patchChoice(i, patch)}
            onRemove={() => removeChoice(i)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...choices, newChoice()])}
        className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-hover pt-2"
      >
        <Plus className="w-3.5 h-3.5" /> Add a choice
      </button>
    </div>
  );
}

function ChoiceRow({
  index,
  choice,
  onPatch,
  onRemove,
}: {
  index: number;
  choice: ScanChoice;
  onPatch: (patch: Partial<ScanChoice>) => void;
  onRemove: () => void;
}) {
  const [paramsText, setParamsText] = useState(
    choice.params ? JSON.stringify(choice.params, null, 2) : '',
  );
  const [paramsError, setParamsError] = useState<string | null>(null);

  const onParamsChange = (text: string) => {
    setParamsText(text);
    if (!text.trim()) { setParamsError(null); onPatch({ params: undefined }); return; }
    try {
      onPatch({ params: JSON.parse(text) });
      setParamsError(null);
    } catch {
      setParamsError('Fix the JSON to save these params.');
    }
  };

  return (
    // Generous space above each header so every choice reads as its own section,
    // clearly set off from the divider above it.
    <div className="pt-8 pb-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Choice {index + 1}</span>
        <button type="button" onClick={onRemove} className="icon-link ml-auto" title="Remove choice">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="block flex-1 min-w-[12rem]">
          <span className="block text-xs text-text-secondary mb-1">Label <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">Button text — what the associate reads.</span>
          <input value={choice.label} onChange={(e) => onPatch({ label: e.target.value })} className="input w-full" placeholder="Collected" />
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Runs <span className="text-status-error">*</span></span>
          <span className="block text-2xs text-text-tertiary mb-1">The action this choice performs.</span>
          <select
            value={choice.verb}
            onChange={(e) => onPatch({ verb: e.target.value as ScanVerb })}
            className="select"
          >
            {CHOICE_VERBS.map((verb) => <option key={verb} value={verb}>{verb}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Code</span>
          <span className="block text-2xs text-text-tertiary mb-1">Short token for double-scan selection.</span>
          <input
            value={choice.code ?? ''}
            onChange={(e) => onPatch({ code: e.target.value || undefined })}
            className="input w-[10rem] font-mono"
            placeholder="COLLECT"
          />
        </label>
        <label className="block flex-1 min-w-[14rem]">
          <span className="block text-xs text-text-secondary mb-1">Confirmation</span>
          <span className="block text-2xs text-text-tertiary mb-1">Ask before running — empty runs on tap.</span>
          <input
            value={choice.confirm?.prompt ?? ''}
            onChange={(e) => onPatch({ confirm: e.target.value ? { prompt: e.target.value } : undefined })}
            className="input w-full"
            placeholder="Run without asking"
          />
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            checked={!!choice.requireActingIdentity}
            onChange={(e) => onPatch({ requireActingIdentity: e.target.checked || undefined })}
          />
          <span className="text-xs text-text-secondary" title="This choice runs only for a badged (or write-capable) user.">
            Requires acting identity
          </span>
        </label>
      </div>
      <label className="block">
        <span className="block text-xs text-text-secondary mb-1">Params (JSON)</span>
        <span className="block text-2xs text-text-tertiary mb-1">
          The verb's parameters — resolverPayload, targetRole, metadata, durationMinutes.
        </span>
        <textarea
          value={paramsText}
          onChange={(e) => onParamsChange(e.target.value)}
          rows={3}
          className="textarea w-full font-mono text-sm"
          placeholder={'{ "resolverPayload": { "outcome": "collected" } }'}
        />
        {paramsError && <span className="block text-2xs text-status-error mt-1">{paramsError}</span>}
      </label>
    </div>
  );
}
