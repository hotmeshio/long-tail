import { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { HelpCircle, Info, Tags, Layers, Braces, Sparkles, User, ListFilter, Search, AlertCircle } from 'lucide-react';
import { SlidePanel, SlidePanelViews, PanelField, type SlidePanelView } from '../common/layout/SlidePanel';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';
import { JsonViewer } from '../common/data/JsonViewer';
import { StatusBadge } from '../common/display/StatusBadge';
import { EscalationTimeline } from '../common/display/EscalationTimeline';
import { RolePill } from '../common/display/RolePill';
import { CountdownTimer } from '../common/display/CountdownTimer';
import { DateValue } from '../common/display/DateValue';
import { CopyableId } from '../common/display/CopyableId';
import { UserName } from '../common/display/UserName';
import { TriageContext } from './TriageContext';
import { buildHelpMarkdown, defaultHelpMarkdown } from '../../lib/x-lt-help';
import { deriveFieldLabel } from '../../lib/derive-field-label';
import { metadataFacetUrl } from '../../lib/facet-url';
import type { LTEscalationRecord } from '../../api/types';
import type { FieldError } from '../../lib/field-validator';

export const ESCALATION_PANEL_VIEWS = {
  HELP: 'help',
  DETAILS: 'details',
  TRIAGE: 'triage',
  METADATA: 'metadata',
  CONTEXT: 'context',
  RECORD: 'record',
  ERRORS: 'errors',
} as const;

const PANEL_VIEW_KEY = 'lt:escalation:panel:view';

function readPanelView(validIds: readonly string[]): PanelViewId {
  try {
    const v = localStorage.getItem(PANEL_VIEW_KEY);
    if (v && validIds.includes(v)) return v as PanelViewId;
  } catch {}
  return ESCALATION_PANEL_VIEWS.HELP;
}

type PanelViewId = (typeof ESCALATION_PANEL_VIEWS)[keyof typeof ESCALATION_PANEL_VIEWS];

/** Metadata keys that are plumbing, not information for the person resolving. */
const HIDDEN_METADATA_KEYS = new Set(['form_schema']);

function MetadataList({ metadata, role }: { metadata: Record<string, unknown> | null; role: string }) {
  const entries = Object.entries(metadata ?? {}).filter(
    ([k]) => !k.startsWith('_') && !HIDDEN_METADATA_KEYS.has(k),
  );
  if (entries.length === 0) {
    return <p className="text-xs text-text-tertiary italic">No metadata on this escalation.</p>;
  }
  return (
    <dl className="space-y-3.5">
      {entries.map(([key, value]) => {
        const displayValue = typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value);
        const roleUrl = metadataFacetUrl(key, value, role);
        const globalUrl = metadataFacetUrl(key, value);
        return (
          <div key={key} className="group relative">
            <dt className="text-2xs font-medium text-text-secondary uppercase tracking-wide">
              {deriveFieldLabel(key)}
            </dt>
            <dd className="mt-0.5 flex items-center gap-1">
              <span className="text-[12px] text-text-primary font-mono break-all flex-1">
                {displayValue}
              </span>
              <Link
                to={roleUrl}
                title={`Filter this queue: ${key} = ${displayValue}`}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 text-text-quaternary hover:text-accent"
              >
                <ListFilter className="w-3 h-3" />
              </Link>
              <Link
                to={globalUrl}
                title={`Search all queues: ${key} = ${displayValue}`}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 text-text-quaternary hover:text-accent"
              >
                <Search className="w-3 h-3" />
              </Link>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The escalation's status facts — what used to sit as a strip above the form. */
function DetailsList({ esc, claimed, isTerminal, isBuilder, traceUrl }: {
  esc: LTEscalationRecord;
  claimed: boolean;
  isTerminal: boolean;
  isBuilder: boolean;
  traceUrl: string | null;
}) {
  return (
    <div className="space-y-5">
      <dl className="space-y-3.5">
        <PanelField label="Status"><StatusBadge status={esc.status} /></PanelField>
        <PanelField label="Assigned to Role"><RolePill role={esc.role} size="md" /></PanelField>
        <PanelField label="Priority">P{esc.priority}</PanelField>
        {(claimed || isTerminal) && esc.assigned_to && (
          <PanelField label="Claimed By">
            <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
              <User className="w-3 h-3 shrink-0 text-accent/75" />
              <UserName userId={esc.assigned_to} />
            </span>
          </PanelField>
        )}
        <PanelField label="Created"><DateValue date={esc.created_at} /></PanelField>
        {(claimed || isTerminal) && esc.claimed_at && (
          <PanelField label="Claimed"><DateValue date={esc.claimed_at} /></PanelField>
        )}
        {claimed && !isTerminal && esc.assigned_until && (
          <PanelField label="Time Remaining"><CountdownTimer until={esc.assigned_until} /></PanelField>
        )}
        {esc.resolved_at && (
          <PanelField label="Completed">
            <span className="text-status-success"><DateValue date={esc.resolved_at} /></span>
          </PanelField>
        )}
      </dl>

      {/* Identifiers — builder-facing references, quietly below a divider */}
      {isBuilder && (
        <>
          <hr className="border-surface-border/60" />
          <div className="space-y-3.5">
            <CopyableId label="Escalation ID" value={esc.id} />
            {esc.task_id && (
              <CopyableId label="Task ID" value={esc.task_id} href={`/workflows/tasks/detail/${esc.task_id}`} />
            )}
            {esc.workflow_type && (
              <CopyableId label="Workflow Name" value={esc.workflow_type} href={`/workflows/executions?entity=${encodeURIComponent(esc.workflow_type)}`} />
            )}
            {esc.workflow_id && (
              <CopyableId label="Workflow ID" value={esc.workflow_id} href={`/workflows/executions/${esc.workflow_id}`} />
            )}
            {esc.task_queue && (
              <CopyableId label="Task Queue" value={esc.task_queue} href={`/admin/controlplane?queue=${encodeURIComponent(esc.task_queue)}`} />
            )}
            {esc.origin_id && esc.origin_id !== esc.workflow_id && (
              <CopyableId label="Origin" value={esc.origin_id} href={`/processes/detail/${esc.origin_id}`} />
            )}
            {esc.trace_id && (
              <CopyableId
                label="Trace"
                value={esc.trace_id}
                href={traceUrl ? traceUrl.replace('{traceId}', esc.trace_id) : undefined}
                external
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ErrorsPanel({ errors, schema }: { errors: FieldError[]; schema?: Record<string, unknown> | null }) {
  const focusField = (field: string) => {
    const el = document.querySelector<HTMLElement>(`[data-field-key="${field}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };

  if (errors.length === 0) {
    return <p className="text-xs text-text-tertiary italic">No errors to display.</p>;
  }

  return (
    <div className="space-y-1" role="alert" aria-live="polite">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-status-error mb-4">
        {errors.length} {errors.length === 1 ? 'issue' : 'issues'} to resolve
      </p>
      <div className="space-y-1.5">
        {errors.map(({ field, message }) => (
          <button
            key={field}
            onClick={() => focusField(field)}
            className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded hover:bg-status-error/5 transition-colors group"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-status-error/60 group-hover:text-status-error transition-colors" />
            <div>
              <p className="text-2xs font-semibold text-text-primary leading-snug">
                {deriveFieldLabel(field, (schema?.properties as Record<string, Record<string, unknown>> | undefined)?.[field])}
              </p>
              <p className="text-2xs text-text-tertiary group-hover:text-text-secondary transition-colors leading-snug mt-0.5">
                {message}
              </p>
            </div>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-text-quaternary mt-4 px-3">
        Click an issue to scroll to and focus the field.
      </p>
    </div>
  );
}

/**
 * The escalation detail side panel — a set of views beside the resolve form,
 * ordered by specificity:
 *
 *   Help      — the form's `x-lt-help` markdown ({{token}}-interpolated), or a
 *               state-aware hint when the schema carries none
 *   Details   — status, role, claim provenance, timestamps, identifiers
 *   AI Analysis — what triage diagnosed and corrected (when AI is enabled and
 *               the payload carries triage data)
 *   Metadata  — the row's metadata values, the facts stamped at enqueue
 *   Context   — the expanded surface: input envelope, escalation context, and
 *               resolver payload
 *   Record    — the raw escalation record (builders only)
 */
export function EscalationSidePanel({
  esc,
  schema,
  envelope,
  payload,
  resolver,
  triage,
  hasAI,
  claimed,
  claimedByMe,
  isTerminal,
  isBuilder,
  traceUrl,
  open,
  noGutter,
  formErrors,
  activePanel,
  onPanelChange,
}: {
  esc: LTEscalationRecord;
  schema: Record<string, unknown> | null;
  envelope: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  resolver: Record<string, unknown> | null;
  triage: Record<string, unknown> | null;
  hasAI: boolean;
  claimed: boolean;
  claimedByMe: boolean;
  isTerminal: boolean;
  isBuilder: boolean;
  traceUrl: string | null;
  open: boolean;
  /** Remove the left gutter so the panel background is flush with the content column (used in full-bleed iframe mode). */
  noGutter?: boolean;
  /** Structured form validation errors from the last submit attempt. When non-empty, the errors panel is available. */
  formErrors?: FieldError[];
  /** Controlled active panel view id. When provided, the panel uses this instead of internal state. */
  activePanel?: string;
  /** Called when the user changes the active panel view. */
  onPanelChange?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const ALL_VIEW_IDS = Object.values(ESCALATION_PANEL_VIEWS) as readonly string[];
  const [internalView, setInternalView] = useState<PanelViewId>(() => readPanelView(ALL_VIEW_IDS));

  const activeView = (activePanel as PanelViewId | undefined) ?? internalView;

  const handleViewChange = useCallback((id: string) => {
    try { localStorage.setItem(PANEL_VIEW_KEY, id); } catch {}
    setInternalView(id as PanelViewId);
    onPanelChange?.(id);
  }, [onPanelChange]);

  // Sync to controlled activePanel when it changes externally (e.g. page forces 'errors' after submit).
  useEffect(() => {
    if (activePanel && activePanel !== internalView) {
      setInternalView(activePanel as PanelViewId);
    }
  }, [activePanel]); // eslint-disable-line react-hooks/exhaustive-deps

  const helpMarkdown = useMemo(() => {
    const authored = buildHelpMarkdown(schema, {
      escalation: esc as unknown as Record<string, unknown>,
      metadata: esc.metadata ?? null,
      envelope,
      payload,
      resolver,
    });
    return authored ?? defaultHelpMarkdown({ isTerminal, status: esc.status, claimed, claimedByMe });
  }, [schema, esc, envelope, payload, resolver, isTerminal, claimed, claimedByMe]);

  // Relative links in help markdown navigate in-app instead of reloading.
  const handleHelpClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (href?.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  }, [navigate]);

  const views: SlidePanelView[] = [
    {
      id: ESCALATION_PANEL_VIEWS.HELP,
      icon: HelpCircle,
      label: 'Instructions',
      content: <MarkdownRenderer content={helpMarkdown} onClick={handleHelpClick} />,
    },
    {
      id: ESCALATION_PANEL_VIEWS.DETAILS,
      icon: Info,
      label: 'Details',
      content: <DetailsList esc={esc} claimed={claimed} isTerminal={isTerminal} isBuilder={isBuilder} traceUrl={traceUrl} />,
    },
    ...(hasAI && triage
      ? [{
          id: ESCALATION_PANEL_VIEWS.TRIAGE,
          icon: Sparkles,
          label: 'AI Analysis',
          content: <TriageContext triage={triage} payload={payload ?? {}} />,
        }]
      : []),
    {
      id: ESCALATION_PANEL_VIEWS.METADATA,
      icon: Tags,
      label: 'Metadata',
      content: <MetadataList metadata={esc.metadata} role={esc.role} />,
    },
    {
      id: ESCALATION_PANEL_VIEWS.CONTEXT,
      icon: Layers,
      label: 'Context',
      content: (
        <div className="space-y-5">
          {envelope != null && <JsonViewer data={envelope} label="Input Envelope" />}
          {payload != null && <JsonViewer data={payload} label="Escalation Context" />}
          {resolver != null && <JsonViewer data={resolver} label="Resolver Payload" />}
          {envelope == null && payload == null && resolver == null && (
            <p className="text-xs text-text-tertiary italic">No context on this escalation.</p>
          )}
        </div>
      ),
    },
    ...(isBuilder
      ? [{
          id: ESCALATION_PANEL_VIEWS.RECORD,
          icon: Braces,
          label: 'Record',
          content: <JsonViewer data={esc} label="Escalation Record" />,
        }]
      : []),
    ...(formErrors && formErrors.length > 0
      ? [{
          id: ESCALATION_PANEL_VIEWS.ERRORS,
          icon: (({ className }: { className?: string }) => (
            <AlertCircle className={`${className ?? ''} text-status-error`} />
          )) as SlidePanelView['icon'],
          label: 'Errors',
          content: <ErrorsPanel errors={formErrors} schema={schema} />,
        }]
      : []),
  ];

  return (
    <SlidePanel open={open} width={384} className="h-full">
      {/* The breathing room collapses with the panel — it lives inside the
          animated width, so the closed state reclaims all of it. The column
          is fixed height (like the left nav): the sparkline row persists at
          the top and the active view scrolls independently beneath it. */}
      <div className={`h-full${noGutter ? '' : ' pl-6'}`}>
        {/* One tinted column, top to bottom — the sparkline lives inside it,
            hovering tight (2px y padding) above the icon row, centered at 80%
            so its edge labels never clip. The slim row drops the icons onto
            the same visual line as the page-title icons beside them; only the
            view content below scrolls. */}
        <div className="h-full flex flex-col bg-surface-hover">
          <div className="shrink-0 pt-1.5 pb-0.5 flex justify-center">
            <EscalationTimeline esc={esc} className="w-[80%]" />
          </div>
          <div className="flex-1 min-h-0">
            {/* No close button — the page-header panel icon owns dismissal. */}
            <SlidePanelViews
              views={views}
              activeId={activeView}
              onViewChange={handleViewChange}
              stickyClassName="h-full min-h-0"
            />
          </div>
        </div>
      </div>
    </SlidePanel>
  );
}
