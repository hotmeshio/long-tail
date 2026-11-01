import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { WireEvent } from '../../api/machines';
import { PanelField } from '../../components/common/layout/SlidePanel';
import { formatDateTime } from '../../lib/format';
import { describeAction, formatJson, rowPath, visibleActions, WIRE_VERB_TONE } from './wire-display';

export const WIRE_PANEL_KEY = 'wire';

/**
 * One wire event in full: the envelope, the payload when the server sends it,
 * the violations, and each action with a link to its row.
 */
export function WireDetailPanel({ event, onClose }: { event: WireEvent; onClose: () => void }) {
  const actions = visibleActions(event.actions);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-surface-border/40">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
            {event.kind}{event.event ? <span className="normal-case font-mono"> · {event.event}</span> : null}
          </p>
          <p className="text-sm text-text-primary mt-0.5">{event.summary || event.topic}</p>
        </div>
        <button onClick={onClose} className="icon-link shrink-0 ml-2" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <PanelField label="At">{formatDateTime(event.at)}</PanelField>
          <PanelField label="Direction">{event.direction}</PanelField>
          <PanelField label="Machine"><span className="font-mono">{event.machineId ?? '—'}</span></PanelField>
          <PanelField label="Address"><span className="font-mono">{event.address ?? '—'}</span></PanelField>
          <PanelField label="Channel"><span className="font-mono">{event.channel}</span></PanelField>
          <PanelField label="Retained">{event.retained ? 'yes' : 'no'}</PanelField>
          <div className="col-span-2">
            <PanelField label="Topic"><span className="font-mono break-all">{event.topic}</span></PanelField>
          </div>
          {event.id && (
            <div className="col-span-2">
              <PanelField label="Message id"><span className="font-mono break-all">{event.id}</span></PanelField>
            </div>
          )}
        </dl>

        <section>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
            Violations{event.violations.length ? ` · ${event.violations.length}` : ''}
          </p>
          {event.violations.length === 0 ? (
            <p className="text-2xs text-text-quaternary">The message matched the contract.</p>
          ) : (
            <ul className="space-y-1">
              {event.violations.map((v, i) => (
                <li key={i} className="text-xs text-status-warning">{v}</li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Actions</p>
          {actions.length === 0 ? (
            <p className="text-2xs text-text-quaternary">The gateway took no action.</p>
          ) : (
            <ul className="space-y-1.5">
              {actions.map((a, i) => (
                <li key={`${a.verb}-${i}`} className="text-xs">
                  <span className={WIRE_VERB_TONE[a.verb]}>{describeAction(a)}</span>
                  {a.rowId && (
                    <>
                      {' '}
                      <Link to={rowPath(a.rowId)} className="font-mono text-accent hover:underline">{a.rowId}</Link>
                    </>
                  )}
                  {a.detail && <span className="block text-2xs text-text-tertiary">{a.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">Payload</p>
          {event.payload === undefined ? (
            <p className="text-2xs text-text-quaternary">Builders see the payload here.</p>
          ) : (
            <pre className="text-2xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-sunken rounded px-2 py-1.5">
              {formatJson(event.payload)}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}
