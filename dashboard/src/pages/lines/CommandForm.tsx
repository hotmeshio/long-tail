import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { commandOpsFor, sendCommand, SNAPSHOT_OP, type LineSummaryMachine } from '../../api/machines';
import { rowPath } from './wire-display';

export type CommandOutcome =
  | { request: string; ok: true; rowId: string }
  | { request: string; ok: false; message: string };

/** The scan idiom: the request in mono, the verdict in its tone. */
export function CommandOutcomeBody({ outcome }: { outcome: CommandOutcome }) {
  return (
    <div className="min-w-0" data-testid="command-outcome">
      <div className="text-xs font-mono text-text-secondary truncate" title={outcome.request}>{outcome.request}</div>
      {outcome.ok ? (
        <div className="text-xs font-medium text-status-success">
          Row created{' '}
          <Link to={rowPath(outcome.rowId)} className="font-mono text-accent hover:underline">{outcome.rowId}</Link>
        </div>
      ) : (
        <div className="text-xs font-medium text-status-error">{outcome.message}</div>
      )}
    </div>
  );
}

const ARG_HELPERS = ['jobId', 'recipe'] as const;

function mergeArgKey(text: string, key: string): string {
  let current: Record<string, unknown> = {};
  try {
    const parsed = text.trim() ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
  } catch {
    current = {};
  }
  if (!(key in current)) current[key] = '';
  return JSON.stringify(current, null, 2);
}

function parseArgs(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Args must be a JSON object.');
  }
  return parsed;
}

/**
 * Send one command to a machine: an op from the line's vocabulary and a
 * small JSON args object. The server creates the row; the role decides.
 */
export function CommandForm({
  siteId,
  lineId,
  machine,
}: {
  siteId: string;
  lineId: string;
  machine: LineSummaryMachine;
}) {
  const [op, setOp] = useState('');
  const [args, setArgs] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const ops = commandOpsFor(machine);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!op) return;
    const request = `${op} ${args.trim() || '{}'}`;
    setBusy(true);
    try {
      const parsed = parseArgs(args);
      const receipt = await sendCommand(siteId, lineId, machine.machineId, { op, args: parsed });
      setOutcome({ request, ok: true, rowId: receipt.rowId });
    } catch (err) {
      setOutcome({ request, ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Send command">
      <div>
        <label htmlFor="command-op" className="block text-2xs font-medium text-text-secondary">
          Op <span className="text-status-error">*</span>
        </label>
        <p className="text-2xs text-text-tertiary mb-1">Pick the operation the machine runs.</p>
        <select
          id="command-op"
          className="select text-xs font-mono"
          value={op}
          required
          onChange={(e) => setOp(e.target.value)}
        >
          <option value="" disabled>Choose…</option>
          {ops.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="command-args" className="block text-2xs font-medium text-text-secondary">Args</label>
        <p className="text-2xs text-text-tertiary mb-1">Write a JSON object, or add a key from the helpers.</p>
        <textarea
          id="command-args"
          className="textarea text-2xs font-mono min-h-[4.5rem]"
          value={args}
          placeholder="{}"
          onChange={(e) => setArgs(e.target.value)}
        />
        <div className="flex items-center gap-2 mt-1">
          {ARG_HELPERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setArgs((t) => mergeArgKey(t, key))}
              className="text-2xs font-mono icon-link"
            >
              + {key}
            </button>
          ))}
        </div>
      </div>
      <button type="submit" disabled={busy || !op} className="btn-primary text-xs py-1.5 px-4">
        Send
      </button>
      {outcome && <CommandOutcomeBody outcome={outcome} />}
    </form>
  );
}

/** One click asks the machine for a fresh snapshot, as a command row. */
export function SnapshotButton({
  siteId,
  lineId,
  machineId,
}: {
  siteId: string;
  lineId: string;
  machineId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);

  const ask = async () => {
    setBusy(true);
    try {
      const receipt = await sendCommand(siteId, lineId, machineId, { op: SNAPSHOT_OP, args: {} });
      setOutcome({ request: `${SNAPSHOT_OP} {}`, ok: true, rowId: receipt.rowId });
    } catch (err) {
      setOutcome({ request: `${SNAPSHOT_OP} {}`, ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={ask} disabled={busy} className="btn-secondary text-xs py-1.5 px-4">
        Ask for a snapshot
      </button>
      {outcome && <CommandOutcomeBody outcome={outcome} />}
    </div>
  );
}
