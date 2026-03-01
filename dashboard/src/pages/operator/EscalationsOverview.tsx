import { useEscalationStats } from '../../api/escalations';
import { StatCard } from '../../components/common/StatCard';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';

export function EscalationsOverview() {
  const { data: stats } = useEscalationStats();

  return (
    <div>
      <PageHeader title="Overview" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="Open"
          value={stats?.pending ?? '—'}
          dotClass="bg-status-pending"
        />
        <StatCard
          label="Claimed"
          value={stats?.claimed ?? '—'}
          dotClass="bg-status-active animate-pulse"
        />
        <StatCard
          label="Created (24h)"
          value={stats?.created_24h ?? '—'}
          sub={stats ? `${stats.created_1h} in last hour` : undefined}
        />
        <StatCard
          label="Resolved (24h)"
          value={stats?.resolved_24h ?? '—'}
          sub={stats ? `${stats.resolved_1h} in last hour` : undefined}
          dotClass="bg-status-success"
        />
      </div>

      {(stats?.by_role?.length ?? 0) > 0 && (
        <div>
          <SectionLabel className="mb-4">By Role</SectionLabel>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Role</th>
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary text-right w-24">Pending</th>
                <th className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary text-right w-24">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {stats!.by_role.map((row) => (
                <tr key={row.role} className="border-b border-surface-border last:border-b-0">
                  <td className="py-3 text-sm font-mono text-text-primary">{row.role}</td>
                  <td className="py-3 text-sm text-right">
                    {row.pending > 0 ? (
                      <span className="text-status-pending">{row.pending}</span>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                  <td className="py-3 text-sm text-right">
                    {row.claimed > 0 ? (
                      <span className="text-status-active">{row.claimed}</span>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
