/**
 * Decides whether an OAuth sign-in may create its own account.
 * Enforced server side in the callback; provider hints are not trusted.
 */

export function normalizeDomains(domains: string[] | undefined): string[] {
  return (domains ?? []).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

export function emailDomain(email: string | null | undefined): string | undefined {
  const at = email?.lastIndexOf('@') ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : undefined;
}

/** Whether a sign-in with this email may create its own account. Empty list: any. */
export function mayProvision(email: string | null | undefined, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = emailDomain(email);
  return domain !== undefined && allowedDomains.includes(domain);
}
