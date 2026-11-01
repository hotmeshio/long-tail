import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { ApiError } from '../../api/client';
import { declareLine, retireLine, type LineIndexRow } from '../../api/machines';
import { definitionOf, definitionText, EXAMPLE_DEFINITION, parseDefinition } from './line-index';

export const DECLARE_PANEL_KEY = 'line-declare';
export const DECLARE_PANEL_WIDTH = 460;

type Outcome =
  | { request: string; ok: true; message: string }
  | { request: string; ok: false; message: string };

function OutcomeBody({ outcome }: { outcome: Outcome }) {
  return (
    <div className="min-w-0 space-y-1" data-testid="declare-outcome">
      <div className="text-xs font-mono text-text-secondary truncate" title={outcome.request}>{outcome.request}</div>
      <div className={`text-xs font-medium ${outcome.ok ? 'text-status-success' : 'text-status-error'}`}>{outcome.message}</div>
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return `Someone changed this line first: ${err.message}`;
  return (err as Error).message;
}

/**
 * Declare a line to the registry, or edit and retire one already declared.
 * The definition is the JSON the server validates; a retire asks once more
 * before it goes.
 */
export function LineDeclarePanel({
  initial,
  onClose,
  onDone,
}: {
  initial: LineIndexRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(() => definitionText(initial ? definitionOf(initial) : EXAMPLE_DEFINITION));
  const [version, setVersion] = useState(initial ? String(initial.version) : '');
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseDefinition(text);
    if (!parsed.ok) {
      setOutcome({ request: 'definition', ok: false, message: parsed.message });
      return;
    }
    const { siteId, lineId } = parsed.definition;
    const request = `PUT /machines/lines/${siteId}/${lineId}`;
    setBusy(true);
    try {
      const trimmed = version.trim();
      const { line } = await declareLine(siteId, lineId, {
        definition: parsed.definition,
        ...(trimmed ? { version: Number(trimmed) } : {}),
      });
      setOutcome({ request, ok: true, message: `declared · ${line.machines.length} machine${line.machines.length === 1 ? '' : 's'} · v${line.version}` });
      onDone();
    } catch (err) {
      setOutcome({ request, ok: false, message: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!initial) return;
    const request = `DELETE /machines/lines/${initial.siteId}/${initial.lineId}`;
    setBusy(true);
    try {
      await retireLine(initial.siteId, initial.lineId);
      setOutcome({ request, ok: true, message: 'retired · its gateway stops on every replica' });
      setConfirmRetire(false);
      onDone();
    } catch (err) {
      setOutcome({ request, ok: false, message: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-surface-border/40">
        <div className="min-w-0">
          <p className="text-sm font-mono text-text-primary truncate">{initial ? `${initial.siteId} · ${initial.lineId}` : 'Declare a line'}</p>
          <p className="text-2xs text-text-tertiary mt-0.5">
            {initial ? `${initial.source} · v${initial.version}` : 'The registry keeps it; every replica starts its gateway.'}
          </p>
        </div>
        <button onClick={onClose} className="icon-link shrink-0 ml-2" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label htmlFor="line-definition" className="text-2xs font-medium text-text-secondary uppercase tracking-wide">Definition</label>
          <textarea
            id="line-definition"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={16}
            className="input w-full mt-1 font-mono text-2xs"
          />
          <p className="text-2xs text-text-quaternary mt-1">siteId, lineId and the machines in route order, each with a machineId and a process.</p>
        </div>
        {initial && (
          <div>
            <label htmlFor="line-version" className="text-2xs font-medium text-text-secondary uppercase tracking-wide">Version</label>
            <input
              id="line-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              inputMode="numeric"
              className="input mt-1 font-mono text-2xs w-24"
            />
            <p className="text-2xs text-text-quaternary mt-1">The version you edited; a newer one on the server refuses the save.</p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary text-xs">
            {initial ? 'Save' : 'Declare'}
          </button>
          {initial && !confirmRetire && (
            <button type="button" disabled={busy} onClick={() => setConfirmRetire(true)} className="text-2xs text-status-error hover:underline">
              Retire this line
            </button>
          )}
        </div>
        {initial && confirmRetire && (
          <div className="border-l-2 border-status-error pl-3 space-y-2" data-testid="retire-confirm">
            <p className="text-xs text-text-secondary">
              Retire {initial.siteId} · {initial.lineId}? Its gateway stops on every replica. Rows and roles stay.
            </p>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy} onClick={retire} className="text-xs font-medium text-status-error hover:underline">
                Retire
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmRetire(false)} className="text-xs text-text-secondary hover:underline">
                Keep
              </button>
            </div>
          </div>
        )}
        {outcome && <OutcomeBody outcome={outcome} />}
      </form>
    </div>
  );
}
