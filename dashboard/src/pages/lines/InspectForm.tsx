import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { inspectMessage, type InspectResult } from '../../api/machines';
import { describeAction, formatJson, rowPath, visibleActions, WIRE_VERB_TONE } from './wire-display';

const RETAINED_CHOICES = [
  { value: 'live', label: 'Live', retained: false },
  { value: 'retained', label: 'Retained', retained: true },
] as const;

type Retained = (typeof RETAINED_CHOICES)[number]['value'];

/** A payload that parses as JSON goes as JSON; anything else goes as the text typed. */
export function parsePayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

type InspectOutcome =
  | { request: string; ok: true; result: InspectResult }
  | { request: string; ok: false; message: string };

/** The dry-run verdict: summary, violations in the warning tone, planned actions with row links. */
export function InspectOutcomeBody({ outcome }: { outcome: InspectOutcome }) {
  return (
    <div className="min-w-0 space-y-2" data-testid="inspect-outcome">
      <div className="text-xs font-mono text-text-secondary truncate" title={outcome.request}>{outcome.request}</div>
      {!outcome.ok ? (
        <div className="text-xs font-medium text-status-error">{outcome.message}</div>
      ) : (
        <>
          <div className={`text-xs font-medium ${outcome.result.violations.length ? 'text-status-warning' : 'text-status-success'}`}>
            {outcome.result.kind ?? 'message'}
            {outcome.result.event ? ` · ${outcome.result.event}` : ''}
            {outcome.result.violations.length
              ? ` · ${outcome.result.violations.length} violation${outcome.result.violations.length === 1 ? '' : 's'}`
              : ' · matches the contract'}
          </div>
          {outcome.result.summary && <div className="text-2xs text-text-secondary">{outcome.result.summary}</div>}
          {outcome.result.violations.length > 0 && (
            <ul className="space-y-0.5" aria-label="Violations">
              {outcome.result.violations.map((v, i) => (
                <li key={i} className="text-2xs text-status-warning">{v}</li>
              ))}
            </ul>
          )}
          <div>
            <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">Planned actions</p>
            {visibleActions(outcome.result.actions).length === 0 ? (
              <p className="text-2xs text-text-quaternary">The gateway would take no action.</p>
            ) : (
              <ul className="space-y-0.5" aria-label="Planned actions">
                {visibleActions(outcome.result.actions).map((a, i) => (
                  <li key={`${a.verb}-${i}`} className="text-2xs">
                    <span className={WIRE_VERB_TONE[a.verb]}>{describeAction(a)}</span>
                    {a.rowId && (
                      <>
                        {' '}
                        <Link to={rowPath(a.rowId)} className="font-mono text-accent hover:underline">{a.rowId}</Link>
                      </>
                    )}
                    {a.detail && <span className="text-text-tertiary"> · {a.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {outcome.result.inspections !== undefined && (
            <pre className="text-2xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-sunken rounded px-2 py-1.5">
              {formatJson(outcome.result.inspections)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Inspect a message as a dry run: the leader decodes it and plans what it
 * would do, without applying anything.
 */
export function InspectForm({ siteId, lineId }: { siteId: string; lineId: string }) {
  const [topic, setTopic] = useState('');
  const [payload, setPayload] = useState('');
  const [retained, setRetained] = useState<Retained | ''>('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<InspectOutcome | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const choice = RETAINED_CHOICES.find((c) => c.value === retained);
    if (!topic.trim() || !choice) return;
    const request = `${topic.trim()} ${payload.trim() || '""'}`;
    setBusy(true);
    try {
      const result = await inspectMessage(siteId, lineId, {
        topic: topic.trim(),
        payload: parsePayload(payload),
        retained: choice.retained,
      });
      setOutcome({ request, ok: true, result: { ...result, violations: result.violations ?? [], actions: result.actions ?? [] } });
    } catch (err) {
      setOutcome({ request, ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Inspect a message">
      <div>
        <label htmlFor="inspect-topic" className="block text-2xs font-medium text-text-secondary">
          Topic <span className="text-status-error">*</span>
        </label>
        <p className="text-2xs text-text-tertiary mb-1">Enter the topic the message arrives on.</p>
        <input
          id="inspect-topic"
          className="input text-2xs font-mono"
          value={topic}
          required
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="inspect-payload" className="block text-2xs font-medium text-text-secondary">Payload</label>
        <p className="text-2xs text-text-tertiary mb-1">Paste the body; JSON is sent as JSON, anything else as text.</p>
        <textarea
          id="inspect-payload"
          className="textarea text-2xs font-mono min-h-[5rem]"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="inspect-retained" className="block text-2xs font-medium text-text-secondary">
          Delivery <span className="text-status-error">*</span>
        </label>
        <p className="text-2xs text-text-tertiary mb-1">Say whether the broker would hand this over as a retained message.</p>
        <select
          id="inspect-retained"
          className="select text-xs"
          value={retained}
          required
          onChange={(e) => setRetained(e.target.value as Retained)}
        >
          <option value="" disabled>Choose…</option>
          {RETAINED_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <button type="submit" disabled={busy || !topic.trim() || !retained} className="btn-primary text-xs py-1.5 px-4">
        Inspect
      </button>
      {outcome && <InspectOutcomeBody outcome={outcome} />}
    </form>
  );
}
