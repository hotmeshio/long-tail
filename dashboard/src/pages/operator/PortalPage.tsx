import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { useRoleDetails } from '../../api/roles';
import { useLinkVariables } from '../../hooks/useLinkVariables';
import { useEventSubscriptions } from '../../hooks/useEventContext';
import { useThrottledInvalidation } from '../../hooks/useEventHooks';
import { escalationPattern } from '../../lib/events/subjects';
import { parseEscalationListUrl, singleRoleOf } from '../../lib/escalation-list-url';
import { portalPath, portalsOf } from '../../lib/portal-path';
import { displayRoleTitle } from '../../lib/role-display';
import { PortalGrid } from '../../components/portal/PortalGrid';
import { PortalCounts } from '../../components/portal/PortalCounts';

function EmptyPortal({ text }: { text: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
      <LayoutGrid className="w-6 h-6 text-text-quaternary/50 mb-2" strokeWidth={1} />
      <p className="text-xs text-text-quaternary">{text}</p>
    </div>
  );
}

/**
 * One of a role's portals: a named matrix of pinned views rendered as one
 * page of live panels. Any signed-in user may open it; every panel reads
 * through the same role-scoped list endpoints as the list page, so each
 * viewer sees what their read scope returns. With no portal key the role's
 * first portal shows. One subscription over the queues the cells name keeps
 * every panel current.
 */
export function PortalPage() {
  const { role = '', portal: portalKey } = useParams<{ role: string; portal?: string }>();
  const { data: roleData, isFetched } = useRoleDetails();
  const { resolveUrl } = useLinkVariables();

  const detail = roleData?.roles.find((r) => r.role === role);
  const portals = portalsOf(detail);
  const portal = portalKey ? portals.find((p) => p.key === portalKey) : portals[0];
  const rows = portal?.rows ?? null;
  const counts = portal?.counts ?? [];
  const from = portal ? portalPath(role, portal.key) : portalPath(role);

  // The queues the cells and count tiles name, each subscribed once; a URL
  // scoped to no single role widens the subscription to the whole family.
  const patterns = useMemo(() => {
    if (!rows) return [];
    const roles = new Set<string>();
    let wide = false;
    for (const pin of [...rows.flat(), ...counts]) {
      const params = parseEscalationListUrl(resolveUrl(pin.url));
      if (!params) continue;
      const scoped = singleRoleOf(params);
      if (scoped) roles.add(scoped); else wide = true;
    }
    return wide ? [escalationPattern({})] : [...roles].sort().map((r) => escalationPattern({ role: r }));
  }, [rows, counts, resolveUrl]);
  const invalidate = useThrottledInvalidation('LIST');
  useEventSubscriptions(patterns, () => { invalidate([['escalations']]); });

  const cellCount = rows ? rows.reduce((n, r) => n + r.length, 0) : 0;
  const empty = !isFetched ? null
    : portals.length === 0 ? 'This role declares no portal yet. Compose one under Admin, Roles, Portal.'
    : !portal ? 'This role has no portal by that name.'
    : null;

  // The panels are the page. The shell pads the content box py-8 pb-16; the
  // portal pulls those back to the side gutter so the frame reads evenly on
  // a screen, and the heading demotes to a quiet caption above the grid.
  return (
    <div className="flex-1 min-h-0 flex flex-col -mt-[calc(2rem-var(--lt-space-page-x))] -mb-[calc(4rem-var(--lt-space-page-x))]">
      <div className="flex items-center gap-2 mb-3 shrink-0 text-2xs uppercase tracking-widest text-text-tertiary">
        <LayoutGrid className="w-3 h-3 text-accent/60 shrink-0" strokeWidth={1.5} />
        <h1 className="truncate font-semibold" title={role}>{displayRoleTitle(detail ?? { role })}</h1>
        {portal && (
          <>
            <span className="text-text-quaternary">·</span>
            <span className="truncate" data-testid="portal-title">{portal.label}</span>
          </>
        )}
        {cellCount > 0 && (
          <span className="text-text-quaternary normal-case tracking-normal">
            {cellCount} {cellCount === 1 ? 'view' : 'views'}
          </span>
        )}
      </div>
      {!isFetched ? null
        : empty ? <EmptyPortal text={empty} />
        : (
          <>
            <PortalCounts counts={counts} resolveUrl={resolveUrl} />
            <PortalGrid rows={rows!} resolveUrl={resolveUrl} from={from} />
          </>
        )}
    </div>
  );
}
