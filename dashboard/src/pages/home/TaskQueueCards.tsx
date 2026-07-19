import { useState, useMemo } from 'react';
import { Layers } from 'lucide-react';
import { useStationMetrics } from '../../api/escalations';
import { useRoleDetails } from '../../api/roles';
import { useTaskQueueRoles } from '../../hooks/useTaskQueueRoles';
import { useMyEscalationCount } from '../../hooks/useMyEscalationCount';
import { TaskQueueCard, ClaimedCard } from './TaskQueueCard';

const PERIODS = ['15m', '1h', '24h', '7d'] as const;
type Period = (typeof PERIODS)[number];

/**
 * The scoped runner's home: their own claimed work first, then one card per
 * lane they belong to — pending / claimed / resolved and a jeopardy signal over
 * a chosen window. A poor-man's Pace Board: no cross-role trend, just "what is
 * in my lanes and what needs attention." Engineers get a single compact row
 * (workflows sit below); operators get the fuller two-row surface.
 */
export function TaskQueueCards({ maxRows }: { maxRows: 1 | 2 }) {
  const [period, setPeriod] = useState<Period>('24h');
  const roles = useTaskQueueRoles();
  const claimedCount = useMyEscalationCount();
  const metricsQ = useStationMetrics(period);
  const rolesQ = useRoleDetails();

  const metricByRole = useMemo(
    () => new Map((metricsQ.data?.stations ?? []).map((m) => [m.role, m])),
    [metricsQ.data],
  );
  const detailByRole = useMemo(
    () => new Map((rolesQ.data?.roles ?? []).map((r) => [r.role, r])),
    [rolesQ.data],
  );

  // Lanes lead with the most at-risk: sort by jeopardy count (a hard limit the
  // plant manager pulls to the front of the line), then alphabetically for a
  // stable order among ties. Card #1 is always Claimed, ahead of these.
  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const ja = metricByRole.get(a)?.priority_count ?? 0;
      const jb = metricByRole.get(b)?.priority_count ?? 0;
      if (jb !== ja) return jb - ja;
      return a.localeCompare(b);
    });
  }, [roles, metricByRole]);

  // The rest of the grid is lanes. Cap to the persona's row budget and surface
  // any overflow rather than hiding it.
  const slots = maxRows * 4;
  const laneBudget = slots - 1;
  const shownRoles = sortedRoles.slice(0, laneBudget);
  const overflow = sortedRoles.length - shownRoles.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-surface-border">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Layers className="w-4 h-4 text-accent" strokeWidth={1.5} />
          Task Queues
        </h2>
        <div className="flex items-center gap-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded transition-colors ${
                period === p
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-text-quaternary hover:text-text-secondary'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {roles.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ClaimedCard count={claimedCount} />
          <div className="lg:col-span-3 flex items-center px-4 py-3.5 text-sm text-text-tertiary">
            You are not a member of a role. Task queues appear here once you join one.
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
            <ClaimedCard count={claimedCount} />
            {shownRoles.map((role) => (
              <TaskQueueCard
                key={role}
                role={role}
                title={detailByRole.get(role)?.title ?? null}
                metric={metricByRole.get(role)}
                priorityFacet={detailByRole.get(role)?.priority_facet ?? null}
                periodLabel={period}
              />
            ))}
          </div>
          {overflow > 0 && (
            <p className="mt-3 text-[11px] text-text-quaternary">
              +{overflow} more {overflow === 1 ? 'lane' : 'lanes'} in the Task Queues sidebar.
            </p>
          )}
        </>
      )}
    </div>
  );
}
