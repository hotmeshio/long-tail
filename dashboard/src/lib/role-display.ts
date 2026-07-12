/**
 * Derive a human-readable name from a role id. camelCase, kebab-case, and
 * snake_case all read as spaced Title Case — printFarm, print-farm, and
 * print_farm each become "Print Farm". Interior capitals are preserved so
 * acronym segments keep their shape (printQA → "Print QA").
 */
export function deriveRoleTitle(role: string): string {
  return role
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym → word boundary (QAReview)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The display name for a role: a user-set title wins; otherwise the name is
 * derived from the role id. Every role therefore has a friendly name — the
 * display name leads, and the exact role id renders as the secondary field.
 */
export function displayRoleTitle(r: { role: string; title?: string | null }): string {
  return r.title?.trim() || deriveRoleTitle(r.role);
}
