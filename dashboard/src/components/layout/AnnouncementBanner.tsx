import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAnnouncements, ANNOUNCEMENT_SUBJECT, type Announcement } from '../../api/announcements';
import { useEventSubscription } from '../../hooks/useEventContext';
import { useAuth } from '../../hooks/useAuth';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';

const DISMISSED_KEY_PREFIX = 'lt-announcement-dismissed:';

/** MarkdownRenderer injects HTML unescaped — author bodies must be entity-escaped first. */
function escapeEntities(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(`${DISMISSED_KEY_PREFIX}${id}`) === '1';
  } catch {
    return false;
  }
}

/**
 * The dashboard announcement surface (system.surfaces.dashboard). Live events
 * broadcast to every socket, so the client re-filters by role and expiry.
 */
export function AnnouncementBanner() {
  const { isAuthenticated, userRoleNames } = useAuth();
  const { data } = useAnnouncements(isAuthenticated);
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dismissTick, setDismissTick] = useState(0);

  useEventSubscription(ANNOUNCEMENT_SUBJECT, () => {
    queryClient.invalidateQueries({ queryKey: ['announcements'] });
  });

  const now = Date.now();
  const visible = (data?.announcements ?? []).filter(
    (a: Announcement) =>
      !isDismissed(a.id) &&
      new Date(a.expires_at).getTime() > now &&
      (a.roles.length === 0 || a.roles.some((r) => userRoleNames.includes(r))),
  );
  void dismissTick;

  // Re-render at the soonest expiry so a lapsed notice drops without a reload.
  useEffect(() => {
    const upcoming = (data?.announcements ?? [])
      .map((a: Announcement) => new Date(a.expires_at).getTime() - Date.now())
      .filter((ms: number) => ms > 0);
    if (upcoming.length === 0) return;
    const timer = setTimeout(() => setDismissTick((t) => t + 1), Math.min(...upcoming) + 250);
    return () => clearTimeout(timer);
  }, [data, dismissTick]);

  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    try {
      localStorage.setItem(`${DISMISSED_KEY_PREFIX}${id}`, '1');
    } catch { /* private mode — the banner returns next load */ }
    setDismissTick((t) => t + 1);
  };

  return (
    // Above the resting header (z-30) — its logo art overflows onto this row.
    <div data-testid="announcement-banner" className="relative z-40">
      {visible.map((a) => {
        const expanded = expandedId === a.id;
        const headline = a.title ?? a.body.split('\n')[0];
        return (
          <div key={a.id} className="border-b border-accent/25 bg-accent/10">
            <div className="flex items-center gap-2 px-4 py-1.5">
              <span className="text-2xs font-semibold uppercase tracking-widest text-accent">Notice</span>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : a.id)}
                className="flex items-center gap-1.5 text-xs text-text-primary hover:text-accent transition-colors min-w-0"
              >
                <span className="truncate">{headline}</span>
                {expanded
                  ? <ChevronUp className="w-3 h-3 shrink-0" strokeWidth={1.5} />
                  : <ChevronDown className="w-3 h-3 shrink-0" strokeWidth={1.5} />}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => dismiss(a.id)}
                className="icon-link"
                title="Dismiss"
                aria-label={`Dismiss ${headline}`}
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
            {expanded && (
              <div className="px-4 pb-3 text-sm text-text-secondary max-w-measure">
                <MarkdownRenderer content={escapeEntities(a.body)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
