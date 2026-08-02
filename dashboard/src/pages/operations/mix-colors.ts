// ---------------------------------------------------------------------------
// State-mix color assignment — a small ordered palette of the -graphic status
// tokens (chart-grade contrast) assigned to subtypes by dwell rank. The null
// subtype is a REAL group (rows created without one): it gets a key, a color,
// and a label — dropping it would misstate the total tracked time.
// ---------------------------------------------------------------------------

export const MIX_PALETTE = [
  'rgb(var(--lt-status-queued-graphic))',   // sky
  'rgb(var(--lt-status-claimed-graphic))',  // orange
  'rgb(var(--lt-status-success-graphic))',  // green
  'rgb(var(--lt-status-pending-graphic))',  // amber
  'rgb(var(--lt-status-error))',            // red
  'rgb(var(--lt-accent))',
] as const;

export const NO_SUBTYPE_KEY = '∅';
export const NO_SUBTYPE_LABEL = 'no subtype';

/** Map key for a subtype group (null/undefined collapse to the ∅ group). */
export function subtypeKey(subtype: string | null | undefined): string {
  return subtype ?? NO_SUBTYPE_KEY;
}

export function subtypeLabel(subtype: string | null | undefined): string {
  return subtype ?? NO_SUBTYPE_LABEL;
}

/**
 * Stable ordered assignment over arbitrary labels: sorted by total weight
 * descending (alphabetical tiebreak so equal ranks never swap), palette
 * wrapping beyond its length. Deterministic for a given entry set.
 */
export function assignLabelColors(
  entries: Array<{ label: string; weight: number }>,
): Map<string, string> {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.label, (totals.get(e.label) ?? 0) + e.weight);
  const ranked = [...totals.entries()].sort(
    ([ak, av], [bk, bv]) => bv - av || (ak < bk ? -1 : 1),
  );
  const colors = new Map<string, string>();
  ranked.forEach(([key], i) => colors.set(key, MIX_PALETTE[i % MIX_PALETTE.length]));
  return colors;
}

/** The subtype-keyed form used by the station MIX surfaces. */
export function assignMixColors(
  groups: { subtype?: string | null; dwellSeconds?: number; count?: number }[],
): Map<string, string> {
  return assignLabelColors(
    groups.map((g) => ({ label: subtypeKey(g.subtype), weight: g.dwellSeconds ?? g.count ?? 0 })),
  );
}
