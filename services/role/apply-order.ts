/**
 * The order declared roles are applied in. A role's `parent_role` must exist
 * before the role that names it, so parents come first; otherwise the
 * declaration order stands. A parent outside the list is taken to exist.
 */

/** Roles ordered parents first; a cycle of parent_role throws, naming the roles in it. */
export function orderRolesByParent<T extends { role: string; parent_role?: string | null }>(roles: readonly T[]): T[] {
  const byName = new Map(roles.map((r) => [r.role, r]));
  const ordered: T[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];
  const visit = (r: T): void => {
    if (done.has(r.role)) return;
    const at = visiting.indexOf(r.role);
    if (at >= 0) throw new Error(`roles form a parent_role cycle: ${[...visiting.slice(at), r.role].join(' → ')}`);
    visiting.push(r.role);
    const parent = r.parent_role ? byName.get(r.parent_role) : undefined;
    if (parent) visit(parent);
    visiting.pop();
    done.add(r.role);
    ordered.push(r);
  };
  for (const r of roles) visit(r);
  return ordered;
}
