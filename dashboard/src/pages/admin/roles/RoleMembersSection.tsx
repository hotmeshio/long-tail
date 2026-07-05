import { useUsers } from '../../../api/users';
import type { LTUserRole } from '../../../api/types/users';

/**
 * Who can see through this role's window, and how far. Membership is admin or
 * member; a member's reach over the queue is two axes — read (which
 * escalations appear: their own, or the whole queue) and write (which they can
 * claim and resolve: none, their own, or the whole queue).
 */
export function RoleMembersSection({ role }: { role: string }) {
  const { data } = useUsers({ role, limit: 100 });
  const users = data?.users ?? [];

  if (users.length === 0) {
    return (
      <p className="text-[11px] text-text-tertiary">
        Assign users to this role to staff its queue. Members see and resolve
        escalations here according to their read/write scope; admins manage the
        role itself.
      </p>
    );
  }

  return (
    <div className="divide-y divide-surface-border/40">
      {users.map((u) => {
        const membership = u.roles.find((r) => r.role === role);
        if (!membership) return null;
        return (
          <div key={u.id} className="flex items-center justify-between py-1.5 gap-2">
            <span className="text-xs text-text-secondary truncate">
              {u.display_name || u.external_id}
            </span>
            <span className="text-[10px] text-text-quaternary font-mono shrink-0">
              {describeMembership(membership)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function describeMembership(m: LTUserRole): string {
  if (m.type === 'superadmin' || m.type === 'admin') return m.type;
  return `member · read ${m.read_scope} · write ${m.write_scope}`;
}
