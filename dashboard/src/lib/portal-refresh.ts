import type { QueryKey } from '@tanstack/react-query';
import type { RolePin } from '../api/roles';
import { escalationPattern, sanitizeSubjectToken } from './events/subjects';
import { parseEscalationListUrl, singleRoleOf } from './escalation-list-url';

/** The subject root every escalation event shares; the role token follows it. */
const ESCALATION_TYPE_PREFIX = 'system.escalation.';
const WIDE_KEYS: QueryKey[] = [['escalations']];

export interface PortalRefreshPlan {
  /** One subscription pattern per queue the portal reads; one wide pattern when a URL names no single queue. */
  patterns: string[];
  /** The query keys an event of this type should refresh: the moved queue's lists, or every list when scope is wide. */
  keysFor(eventType: string): QueryKey[];
}

/**
 * How a portal stays fresh. Every list query key carries its params object,
 * and the query client matches object segments partially, so an event on
 * one queue refreshes only that queue's panels and tiles: `['escalations',
 * { role }]` and `['escalations', 'available', { role }]`. A URL that names
 * several roles or none widens the plan to the whole escalation family.
 */
export function portalRefreshPlan(urls: Array<Pick<RolePin, 'url'>>, resolveUrl: (url: string) => string): PortalRefreshPlan {
  const roles = new Set<string>();
  let wide = false;
  for (const { url } of urls) {
    const params = parseEscalationListUrl(resolveUrl(url));
    if (!params) continue;
    const scoped = singleRoleOf(params);
    if (scoped) roles.add(scoped); else wide = true;
  }
  if (wide || roles.size === 0) {
    return { patterns: wide ? [escalationPattern({})] : [], keysFor: () => WIDE_KEYS };
  }
  const byToken = new Map([...roles].map((role) => [sanitizeSubjectToken(role), role]));
  const patterns = [...roles].sort().map((role) => escalationPattern({ role }));
  return {
    patterns,
    keysFor(eventType) {
      const token = eventType.startsWith(ESCALATION_TYPE_PREFIX) ? eventType.slice(ESCALATION_TYPE_PREFIX.length).split('.')[0] : '';
      const role = byToken.get(token);
      return role ? [['escalations', { role }], ['escalations', 'available', { role }]] : WIDE_KEYS;
    },
  };
}
