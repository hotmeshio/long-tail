import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Users, AlertTriangle, Eye, GitBranch, ArrowRight, ChevronRight } from 'lucide-react';
import { useRoleDetails, type RoleDetail } from '../../api/roles';
import { useEscalationStats } from '../../api/escalations';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { ListToolbar } from '../../components/common/data/ListToolbar';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDependencyTree(
  roles: RoleDetail[],
): { root: RoleDetail; children: RoleDetail[] }[] {
  const opsRoles = roles.filter((r) => r.ops_visible);
  const roots = opsRoles.filter((r) => !r.parent_role || !opsRoles.find((p) => p.role === r.parent_role));
  return roots.map((root) => ({
    root,
    children: opsRoles.filter((r) => r.parent_role === root.role),
  }));
}

// ── Station card ──────────────────────────────────────────────────────────────

function StationCard({
  role,
  pending,
  claimed,
  children,
  stats,
}: {
  role: RoleDetail;
  pending: number;
  claimed: number;
  children: RoleDetail[];
  stats: { by_role: { role: string; pending: number; claimed: number }[] } | undefined;
}) {
  const total = pending + claimed;
  const slaMinutes = (role.properties as any)?.sla_minutes as number | undefined;
  const targetPerHour = (role.properties as any)?.target_per_hour as number | undefined;
  const isOverloaded = targetPerHour && pending > targetPerHour;

  return (
    <div className="space-y-2">
      <Link
        to={`/escalations/available?roles=${encodeURIComponent(JSON.stringify([role.role]))}`}
        className="block group"
      >
        <div
          className={`rounded-none border-l-2 pl-4 py-3 pr-3 transition-colors ${
            isOverloaded
              ? 'border-status-warning bg-[#fffbf0]'
              : total === 0
              ? 'border-surface-border'
              : 'border-accent/40 hover:border-accent'
          }`}
        >
          {/* Role name + badges */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-mono font-medium text-text-primary group-hover:text-accent transition-colors">
                  {role.role}
                </span>
                {role.title && (
                  <span className="text-xs text-text-secondary">{role.title}</span>
                )}
              </div>
              {role.description && (
                <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">
                  {role.description}
                </p>
              )}
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-text-quaternary group-hover:text-accent transition-colors mt-0.5 shrink-0" />
          </div>

          {/* Metrics row */}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex flex-col items-center">
              <span className={`text-lg font-semibold tabular-nums leading-tight ${pending > 0 ? 'text-text-primary' : 'text-text-quaternary'}`}>
                {pending}
              </span>
              <span className="text-[9px] text-text-quaternary uppercase tracking-wider">pending</span>
            </div>
            <div className="flex flex-col items-center">
              <span className={`text-lg font-semibold tabular-nums leading-tight ${claimed > 0 ? 'text-accent' : 'text-text-quaternary'}`}>
                {claimed}
              </span>
              <span className="text-[9px] text-text-quaternary uppercase tracking-wider">active</span>
            </div>
            {slaMinutes && (
              <div className="flex flex-col items-center ml-auto">
                <span className="text-xs font-medium text-text-secondary tabular-nums">{slaMinutes}m</span>
                <span className="text-[9px] text-text-quaternary uppercase tracking-wider">SLA</span>
              </div>
            )}
            {targetPerHour && (
              <div className="flex flex-col items-center">
                <span className={`text-xs font-medium tabular-nums ${isOverloaded ? 'text-status-warning' : 'text-text-secondary'}`}>
                  {targetPerHour}/h
                </span>
                <span className="text-[9px] text-text-quaternary uppercase tracking-wider">target</span>
              </div>
            )}
          </div>

          {/* Overload warning */}
          {isOverloaded && (
            <div className="flex items-center gap-1.5 mt-2">
              <AlertTriangle className="w-3 h-3 text-status-warning shrink-0" />
              <span className="text-[10px] text-status-warning">
                {pending - targetPerHour!} above hourly target
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Child stations */}
      {children.length > 0 && (
        <div className="ml-4 pl-4 border-l border-surface-border/60 space-y-1.5">
          {children.map((child) => {
            const childStats = stats?.by_role.find((s) => s.role === child.role);
            return (
              <Link
                key={child.role}
                to={`/escalations/available?roles=${encodeURIComponent(JSON.stringify([child.role]))}`}
                className="flex items-center justify-between gap-3 py-1.5 group"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <ChevronRight className="w-3 h-3 text-text-quaternary shrink-0" />
                  <span className="text-xs font-mono text-text-secondary group-hover:text-accent transition-colors truncate">
                    {child.role}
                  </span>
                  {child.title && (
                    <span className="text-[10px] text-text-tertiary truncate">{child.title}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(childStats?.pending ?? 0) > 0 && (
                    <span className="text-xs font-medium text-text-primary tabular-nums">
                      {childStats!.pending}
                    </span>
                  )}
                  {(childStats?.claimed ?? 0) > 0 && (
                    <span className="text-xs font-medium text-accent tabular-nums">
                      {childStats!.claimed}
                    </span>
                  )}
                  {!childStats?.pending && !childStats?.claimed && (
                    <span className="text-[10px] text-text-quaternary">idle</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({
  roles,
  stats,
}: {
  roles: RoleDetail[];
  stats: { pending: number; claimed: number; by_role: { role: string; pending: number; claimed: number }[] } | undefined;
}) {
  const opsRoles = roles.filter((r) => r.ops_visible);
  const totalPending = stats?.pending ?? 0;
  const totalActive = stats?.claimed ?? 0;
  const stationsAboveTarget = opsRoles.filter((r) => {
    const target = (r.properties as any)?.target_per_hour as number | undefined;
    if (!target) return false;
    const roleStat = stats?.by_role.find((s) => s.role === r.role);
    return (roleStat?.pending ?? 0) > target;
  }).length;

  return (
    <div className="flex items-center gap-8 py-4 border-b border-surface-border mb-6">
      <div>
        <div className="flex items-center gap-1.5 text-text-quaternary mb-1">
          <Eye className="w-3 h-3" />
          <span className="text-[10px] uppercase tracking-wider">Stations</span>
        </div>
        <span className="text-2xl font-semibold text-text-primary">{opsRoles.length}</span>
      </div>
      <div className="w-px h-8 bg-surface-border" />
      <div>
        <div className="flex items-center gap-1.5 text-text-quaternary mb-1">
          <Clock className="w-3 h-3" />
          <span className="text-[10px] uppercase tracking-wider">Pending</span>
        </div>
        <span className={`text-2xl font-semibold ${totalPending > 0 ? 'text-text-primary' : 'text-text-quaternary'}`}>
          {totalPending}
        </span>
      </div>
      <div className="w-px h-8 bg-surface-border" />
      <div>
        <div className="flex items-center gap-1.5 text-text-quaternary mb-1">
          <Users className="w-3 h-3" />
          <span className="text-[10px] uppercase tracking-wider">Active</span>
        </div>
        <span className={`text-2xl font-semibold ${totalActive > 0 ? 'text-accent' : 'text-text-quaternary'}`}>
          {totalActive}
        </span>
      </div>
      {stationsAboveTarget > 0 && (
        <>
          <div className="w-px h-8 bg-surface-border" />
          <div>
            <div className="flex items-center gap-1.5 text-status-warning mb-1">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-[10px] uppercase tracking-wider">Over target</span>
            </div>
            <span className="text-2xl font-semibold text-status-warning">{stationsAboveTarget}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OperationsPage() {
  const { data: roleData, isLoading: rolesLoading, refetch: refetchRoles } = useRoleDetails();
  const { data: stats, isLoading: statsLoading, isFetching, refetch: refetchStats } = useEscalationStats();

  const roles = roleData?.roles ?? [];
  const opsRoles = roles.filter((r) => r.ops_visible);
  const stationTree = useMemo(() => buildDependencyTree(roles), [roles]);

  const isLoading = rolesLoading || statsLoading;

  const handleRefresh = () => { refetchRoles(); refetchStats(); };

  return (
    <div>
      <PageHeader
        title="Operations"
        docsHash="#docs:dashboard.md:operations"
        actions={
          <div className="flex items-center gap-3">
            <Link to="/admin/roles" className="btn-secondary text-xs flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              Configure Stations
            </Link>
            <ListToolbar onRefresh={handleRefresh} isFetching={isFetching} apiPath="/escalations/stats" />
          </div>
        }
      />

      {isLoading ? (
        <div className="animate-pulse space-y-6 mt-4">
          <div className="h-16 bg-surface-sunken rounded w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-28 bg-surface-sunken rounded" />
            ))}
          </div>
        </div>
      ) : opsRoles.length === 0 ? (
        <div className="mt-8">
          <p className="text-sm text-text-secondary mb-2">No stations configured yet.</p>
          <p className="text-xs text-text-tertiary">
            Go to{' '}
            <Link to="/admin/roles" className="text-accent hover:underline">
              Roles
            </Link>{' '}
            and enable <strong>Visible in Operations view</strong> on roles that represent physical or
            digital stations.
          </p>
        </div>
      ) : (
        <>
          <SummaryBar roles={roles} stats={stats} />

          {stationTree.length > 0 ? (
            <div className="space-y-8">
              {stationTree.map(({ root, children }) => {
                const rootStats = stats?.by_role.find((s) => s.role === root.role);
                return (
                  <StationCard
                    key={root.role}
                    role={root}
                    pending={rootStats?.pending ?? 0}
                    claimed={rootStats?.claimed ?? 0}
                    children={children}
                    stats={stats}
                  />
                );
              })}

              {/* Standalone ops roles that aren't in the tree (no parent, not a parent) */}
              {opsRoles
                .filter(
                  (r) =>
                    !r.parent_role &&
                    !stationTree.find((t) => t.root.role === r.role),
                )
                .map((role) => {
                  const roleStat = stats?.by_role.find((s) => s.role === role.role);
                  return (
                    <StationCard
                      key={role.role}
                      role={role}
                      pending={roleStat?.pending ?? 0}
                      claimed={roleStat?.claimed ?? 0}
                      children={[]}
                      stats={stats}
                    />
                  );
                })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {opsRoles.map((role) => {
                const roleStat = stats?.by_role.find((s) => s.role === role.role);
                return (
                  <StationCard
                    key={role.role}
                    role={role}
                    pending={roleStat?.pending ?? 0}
                    claimed={roleStat?.claimed ?? 0}
                    children={[]}
                    stats={stats}
                  />
                );
              })}
            </div>
          )}

          {/* Process dependency legend */}
          {opsRoles.some((r) => r.parent_role) && (
            <div className="mt-8 pt-4 border-t border-surface-border flex items-center gap-2">
              <GitBranch className="w-3 h-3 text-text-quaternary" />
              <span className="text-[10px] text-text-tertiary">
                Indented stations depend on the parent process above them.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
