import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronRight } from 'lucide-react';
import { MACHINE_FACETS, type LineSummaryMachine, type MachineView } from '../../api/machines';
import { PanelField } from '../../components/common/layout/SlidePanel';
import { EntityTimelinePanel } from '../../components/escalation/EntityTimelinePanel';
import { useShellPanelOptional } from '../../hooks/useShellPanel';
import { formatDateTime } from '../../lib/format';
import { CommandForm, SnapshotButton } from './CommandForm';
import { InspectForm } from './InspectForm';
import { formatJson, PRESENCE_DOT, PRESENCE_LABEL, presenceOf, rowPath } from './wire-display';

export const MACHINE_PANEL_KEY = 'machine';
export const MACHINE_PANEL_WIDTH = 440;
const TIMELINE_PANEL_KEY = 'entity-timeline';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">{title}</p>
      {children}
    </section>
  );
}

function RowLink({ rowId, label }: { rowId: string; label: string }) {
  return (
    <li className="text-2xs">
      <span className="text-text-secondary">{label}</span>{' '}
      <Link to={rowPath(rowId)} className="font-mono text-accent hover:underline">{rowId}</Link>
    </li>
  );
}

/**
 * One machine in the shell's right panel: the last snapshot in brief, its
 * open rows, a way into its timeline, and the tools for those who may act.
 */
export function MachinePanel({
  siteId,
  lineId,
  summary,
  view,
  canAct,
  onClose,
}: {
  siteId: string;
  lineId: string;
  summary: LineSummaryMachine;
  view: MachineView | undefined;
  canAct: boolean;
  onClose: () => void;
}) {
  const presence = presenceOf(view);
  const shell = useShellPanelOptional();
  const [jobsOpen, setJobsOpen] = useState(false);

  // The timeline takes the shell slot; the strip tile reopens this panel.
  const openTimeline = useCallback(
    (facetKey: string) => {
      shell?.setPanel(
        <EntityTimelinePanel facetKey={facetKey} value={summary.machineId} role={summary.role} />,
        { key: TIMELINE_PANEL_KEY, width: 420 },
      );
    },
    [shell, summary.machineId, summary.role],
  );

  const alarms = view?.alarms ?? [];
  const held = view?.heldUnits ?? [];
  const jobs = view?.jobs ?? [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-surface-border/40">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full dot-ring shrink-0 ${PRESENCE_DOT[presence]}`} title={PRESENCE_LABEL[presence]} />
            <span className="text-sm font-mono text-text-primary truncate">{summary.machineId}</span>
            <span className="text-2xs text-text-quaternary">{PRESENCE_LABEL[presence]}</span>
          </div>
          <p className="text-2xs font-mono text-text-tertiary mt-0.5">
            {summary.process} · {summary.role}
          </p>
        </div>
        <button onClick={onClose} className="icon-link shrink-0 ml-2" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <Section title="Snapshot">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <PanelField label="Address">
              <span className="font-mono">{view?.address ?? summary.address ?? '—'}</span>
              <span className="text-text-quaternary"> · {summary.addressing}</span>
            </PanelField>
            <PanelField label="Software"><span className="font-mono">{view?.software ?? '—'}</span></PanelField>
            <PanelField label="Since">{view?.since ? formatDateTime(view.since) : '—'}</PanelField>
            <PanelField label="Last seen">{view?.lastSeen ? formatDateTime(view.lastSeen) : '—'}</PanelField>
            <PanelField label="Boot"><span className="font-mono break-all">{view?.bootId ?? '—'}</span></PanelField>
            <PanelField label="Session"><span className="font-mono break-all">{view?.sessionId ?? '—'}</span></PanelField>
          </dl>
        </Section>

        <Section title={`Jobs · ${jobs.length}`}>
          {jobs.length === 0 ? (
            <p className="text-2xs text-text-quaternary">The last snapshot carried no jobs.</p>
          ) : (
            <>
              <button type="button" onClick={() => setJobsOpen((v) => !v)} className="inline-flex items-center gap-1 text-2xs icon-link">
                <ChevronRight className={`w-3 h-3 transition-transform ${jobsOpen ? 'rotate-90' : ''}`} />
                {jobsOpen ? 'Hide' : 'Show'} the jobs as reported
              </button>
              {jobsOpen && (
                <pre className="mt-1.5 text-2xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-sunken rounded px-2 py-1.5">
                  {formatJson(jobs)}
                </pre>
              )}
            </>
          )}
        </Section>

        <Section title={`Alarms · ${alarms.length}`}>
          {alarms.length === 0 ? (
            <p className="text-2xs text-text-quaternary">The machine reports no active alarm.</p>
          ) : (
            <ul className="space-y-1">
              {alarms.map((a) => (
                <li key={a.alarmId} className="text-2xs flex items-baseline gap-2">
                  <span className="font-mono text-status-warning">{a.alarmId}</span>
                  <span className="text-text-tertiary">{a.level}</span>
                  <span className="text-text-quaternary ml-auto">{formatDateTime(a.raisedAt)}</span>
                  {a.rowId && <Link to={rowPath(a.rowId)} className="font-mono text-accent hover:underline">row</Link>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Held units · ${held.length}`}>
          {held.length === 0 ? (
            <p className="text-2xs text-text-quaternary">The machine holds no unit.</p>
          ) : (
            <ul className="space-y-1">
              {held.map((u) => (
                <RowLink key={u.unitId} rowId={u.rowId} label={u.carrierId ? `${u.unitId} on ${u.carrierId}` : u.unitId} />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Open rows">
          <p className="text-2xs font-mono text-text-secondary tabular-nums">
            handoff {view?.rows.handoff ?? 0} · command {view?.rows.command ?? 0} · alarm {view?.rows.alarm ?? 0}
          </p>
          {(view?.rows.offlineRowId || view?.rows.quietRowId) && (
            <ul className="space-y-1 mt-1">
              {view.rows.offlineRowId && <RowLink rowId={view.rows.offlineRowId} label="offline" />}
              {view.rows.quietRowId && <RowLink rowId={view.rows.quietRowId} label="quiet" />}
            </ul>
          )}
        </Section>

        <Section title="Over a window">
          <p className="text-2xs text-text-tertiary mb-1.5">Open the rows that moved work to or from this machine.</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => openTimeline(MACHINE_FACETS.TO)} className="text-2xs icon-link font-mono">
              {MACHINE_FACETS.TO}
            </button>
            <button type="button" onClick={() => openTimeline(MACHINE_FACETS.FROM)} className="text-2xs icon-link font-mono">
              {MACHINE_FACETS.FROM}
            </button>
          </div>
        </Section>

        {canAct && (
          <>
            <Section title="Ask for a snapshot">
              <SnapshotButton siteId={siteId} lineId={lineId} machineId={summary.machineId} />
            </Section>
            <Section title="Send command">
              <CommandForm siteId={siteId} lineId={lineId} machine={summary} />
            </Section>
            <Section title="Inspect a message">
              <InspectForm siteId={siteId} lineId={lineId} />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
