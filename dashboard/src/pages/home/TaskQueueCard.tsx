import { useNavigate } from 'react-router-dom';
import { ExternalLink, TriangleAlert, Hand } from 'lucide-react';
import type { StationMetric } from '../../api/escalations';
import { jeopardyQueueLink } from '../operations/priority-link';

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'muted' }) {
  return (
    <div className="min-w-0">
      <div className={`text-2xl font-light tabular-nums leading-none ${tone === 'muted' ? 'text-text-tertiary' : 'text-text-primary'}`}>
        {n}
      </div>
      <div className="text-2xs uppercase tracking-wider text-text-quaternary mt-1 truncate">{label}</div>
    </div>
  );
}

/**
 * One lane's shape at a glance: pending / claimed / resolved over the selected
 * window, plus the jeopardy signal when items sit past the role's priority
 * threshold. The card opens the role's queue; the jeopardy pill opens it
 * sorted oldest-first so the at-risk items sit on top.
 */
export function TaskQueueCard({
  role,
  title,
  metric,
  priorityFacet,
  periodLabel,
}: {
  role: string;
  title: string | null;
  metric: StationMetric | undefined;
  priorityFacet: string | null;
  periodLabel: string;
}) {
  const navigate = useNavigate();
  const pending = metric?.pending ?? 0;
  const claimed = metric?.claimed ?? 0;
  const resolved = metric?.resolved ?? 0;
  const jeopardy = metric?.priority_count ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/escalations/available?role=${encodeURIComponent(role)}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/escalations/available?role=${encodeURIComponent(role)}`);
        }
      }}
      className="group h-full border-l-2 border-accent/30 bg-surface-sunken/40 rounded-[0.125em] px-4 py-3.5 cursor-pointer transition-colors hover:bg-surface-sunken/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-secondary truncate">
          {title || role}
        </span>
        <ExternalLink className="w-3 h-3 shrink-0 text-text-quaternary opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />
      </div>

      <div className="flex items-baseline gap-5">
        <Stat n={pending} label="pending" />
        <Stat n={claimed} label="claimed" />
        <Stat n={resolved} label={`resolved · ${periodLabel}`} tone="muted" />
      </div>

      <div className="mt-3 h-6 flex items-center">
        {jeopardy > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(jeopardyQueueLink({ role, priority_facet: priorityFacet }));
            }}
            className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-2xs font-semibold tabular-nums bg-status-error text-text-inverse transition-transform hover:scale-[1.05]"
            title="Past the priority threshold — a hard limit; open oldest first"
          >
            <TriangleAlert className="w-3 h-3" strokeWidth={2.5} />
            {jeopardy} in jeopardy
          </button>
        ) : (
          <span className="text-2xs text-text-quaternary">on pace</span>
        )}
      </div>
    </div>
  );
}

/**
 * The runner's own work, across every lane. First and highlighted — what to
 * finish before pulling anything new. Opens their personal queue.
 */
export function ClaimedCard({ count }: { count: number }) {
  const navigate = useNavigate();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/escalations/queue')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate('/escalations/queue');
        }
      }}
      className="group h-full border-l-2 border-status-warning/70 bg-status-warning/[0.06] rounded-[0.125em] px-4 py-3.5 cursor-pointer transition-colors hover:bg-status-warning/[0.1] focus:outline-none focus-visible:ring-1 focus-visible:ring-status-warning/40"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-status-warning">
          <Hand className="w-3 h-3" strokeWidth={2} />
          Claimed
        </span>
        <ExternalLink className="w-3 h-3 shrink-0 text-text-quaternary opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />
      </div>

      <div className="text-2xl font-light tabular-nums leading-none text-text-primary">{count}</div>
      <div className="text-2xs uppercase tracking-wider text-text-quaternary mt-1">assigned to you</div>

      <div className="mt-3 h-6 flex items-center">
        <span className="text-2xs font-medium text-status-warning">
          {count > 0 ? 'Finish these first →' : 'Nothing claimed'}
        </span>
      </div>
    </div>
  );
}
