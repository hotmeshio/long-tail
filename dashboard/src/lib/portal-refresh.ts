import type { RolePin } from '../api/roles';
import { escalationPattern } from './events/subjects';
import { parseEscalationListUrl, singleRoleOf } from './escalation-list-url';

/**
 * The subscriptions a portal needs: one pattern per queue its cells and
 * tiles read, or the escalation family when a URL names several queues or
 * none. Which cached panels an event refreshes is decided per event by the
 * escalation router.
 */
export function portalRefreshPatterns(urls: Array<Pick<RolePin, 'url'>>, resolveUrl: (url: string) => string): string[] {
  const roles = new Set<string>();
  let wide = false;
  for (const { url } of urls) {
    const params = parseEscalationListUrl(resolveUrl(url));
    if (!params) continue;
    const scoped = singleRoleOf(params);
    if (scoped) roles.add(scoped); else wide = true;
  }
  if (wide) return [escalationPattern({})];
  return [...roles].sort().map((role) => escalationPattern({ role }));
}
