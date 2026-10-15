/**
 * Pace Board sequences: each line of stations a deployment composes with
 * `parent_role`, over the ops-visible roles. One definition for the board
 * and for list queries that name a segment.
 */

export interface SequenceRole {
  role: string;
  parent_role?: string | null;
  ops_visible?: boolean | null;
}

export interface SequenceStation<R extends SequenceRole> {
  role: R;
  depth: number;
}

export interface RoleSequence<R extends SequenceRole> {
  origin: R;
  stations: SequenceStation<R>[];
}

/** Breadth-first from each root, longest sequence first. */
export function buildRoleSequences<R extends SequenceRole>(roles: R[]): RoleSequence<R>[] {
  const opsRoles = roles.filter((r) => r.ops_visible);
  const roleMap = new Map(opsRoles.map((r) => [r.role, r]));
  const visited = new Set<string>();

  // Roots: no parent, or a parent outside the ops set.
  const roots = opsRoles.filter((r) => !r.parent_role || !roleMap.has(r.parent_role));

  const sequences: RoleSequence<R>[] = roots.map((root) => {
    const stations: SequenceStation<R>[] = [];
    const queue: SequenceStation<R>[] = [{ role: root, depth: 0 }];
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.role.role)) continue;
      visited.add(item.role.role);
      stations.push(item);
      opsRoles
        .filter((c) => c.parent_role === item.role.role && !visited.has(c.role))
        .forEach((c) => queue.push({ role: c, depth: item.depth + 1 }));
    }
    return { origin: root, stations };
  });

  // Unreachable roles (cycles, dangling parents) each stand alone.
  opsRoles
    .filter((r) => !visited.has(r.role))
    .forEach((r) => sequences.push({ origin: r, stations: [{ role: r, depth: 0 }] }));

  return sequences.sort(
    (a, b) => b.stations.length - a.stations.length || a.origin.role.localeCompare(b.origin.role),
  );
}

/** The ordered roles of the sequence that starts at `origin`, or null. */
export function segmentRoles<R extends SequenceRole>(roles: R[], origin: string): string[] | null {
  const sequence = buildRoleSequences(roles).find((s) => s.origin.role === origin);
  return sequence ? sequence.stations.map((s) => s.role.role) : null;
}
