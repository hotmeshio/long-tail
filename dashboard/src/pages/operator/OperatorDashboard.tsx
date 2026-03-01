import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useEscalations } from '../../api/escalations';
import { DataTable, type Column } from '../../components/common/DataTable';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { PriorityBadge } from '../../components/common/PriorityBadge';
import { TimeAgo } from '../../components/common/TimeAgo';
import { CountdownTimer } from '../../components/common/CountdownTimer';
import type { LTEscalationRecord } from '../../api/types';

const columns: Column<LTEscalationRecord>[] = [
  {
    key: 'type',
    label: 'Type',
    render: (row) => (
      <div>
        <p className="text-sm text-text-primary">{row.type}</p>
        {row.subtype && (
          <p className="text-xs text-text-tertiary">{row.subtype}</p>
        )}
      </div>
    ),
  },
  {
    key: 'role',
    label: 'Role',
    render: (row) => (
      <span className="px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full text-text-secondary">
        {row.role}
      </span>
    ),
    className: 'w-32',
  },
  {
    key: 'priority',
    label: 'Priority',
    render: (row) => <PriorityBadge priority={row.priority} />,
    className: 'w-20',
  },
  {
    key: 'expires',
    label: 'Time Left',
    render: (row) =>
      row.assigned_until ? (
        <CountdownTimer until={row.assigned_until} />
      ) : (
        <span className="text-xs text-text-tertiary">—</span>
      ),
    className: 'w-28',
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (row) => <TimeAgo date={row.created_at} />,
    className: 'w-28',
  },
];

interface QuickLinkProps {
  title: string;
  description: string;
  to: string;
}

function QuickLink({ title, description, to }: QuickLinkProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="w-full text-left py-4 border-b border-surface-border transition-colors duration-150 text-text-secondary hover:text-text-primary"
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
    </button>
  );
}

export function OperatorDashboard() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, userRoleNames } = useAuth();

  const { data: myClaims, isLoading } = useEscalations({
    assigned_to: user?.userId,
    status: 'pending',
    limit: 25,
  });

  // Exclude expired claims — they're back in the available pool
  const activeClaims = (myClaims?.escalations ?? []).filter(
    (e) => e.assigned_until && new Date(e.assigned_until) > new Date(),
  );
  const hasClaims = activeClaims.length > 0;

  return (
    <div>
      <PageHeader title="My Queue" />
      <p className="text-sm text-text-tertiary -mt-6 mb-10">
        Roles: {userRoleNames.length > 0 ? userRoleNames.join(', ') : 'none'}
      </p>

      {/* My claimed escalations */}
      {hasClaims && (
        <div>
          <SectionLabel className="mb-4">
            Active Claims ({activeClaims.length})
          </SectionLabel>
          <DataTable
            columns={columns}
            data={activeClaims}
            keyFn={(row) => row.id}
            onRowClick={(row) => navigate(`/escalations/${row.id}`, { state: { from: '/escalations/queue' } })}
            isLoading={isLoading}
            emptyMessage="No active claims"
          />
        </div>
      )}

      {/* Empty state — quick links */}
      {!isLoading && !hasClaims && (
        <div>
          <p className="text-sm text-text-secondary mb-8">
            Your queue is empty. No escalations are currently claimed.
          </p>
          <div className="max-w-md">
            <QuickLink
              title="Available Escalations"
              description="Browse and claim pending escalations"
              to="/escalations"
            />
            <QuickLink
              title="Workflows"
              description="View workflow executions and job history"
              to="/workflows"
            />
            {isSuperAdmin && (
              <QuickLink
                title="Administration"
                description="Workflow configs, users, and MCP servers"
                to="/admin"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
