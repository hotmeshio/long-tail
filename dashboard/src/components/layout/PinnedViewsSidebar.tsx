import { useMemo, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Pin, X, EyeOff, Plus } from 'lucide-react';
import { useSidebar } from '../../hooks/useSidebar';
import { useAuth } from '../../hooks/useAuth';
import { useRoleDetails } from '../../api/roles';
import { usePreferences, usePatchPreferences, type PinnedView } from '../../api/preferences';
import { useEscalations, useAvailableEscalations } from '../../api/escalations';
import { useEventSubscription } from '../../hooks/useEventContext';
import { useQueryClient } from '@tanstack/react-query';
import { NATS_SUBJECT_PREFIX } from '../../lib/nats/config';
import { resolvePins, pinBadgeQuery, newPinId, type ResolvedPin } from '../../lib/pinned-views';

/**
 * "Pinned" — the persona's exact queries, one click away. The user's own pins
 * lead (drag to reorder, ✕ to remove); role-provided defaults follow, marked,
 * with promote (make mine) and hide affordances. Badges are live counts of the
 * pinned query itself, refreshed by escalation events — never polled.
 */
export function PinnedViewsSidebar() {
  const { collapsed } = useSidebar();
  const { user } = useAuth();
  const prefsQ = usePreferences();
  const patch = usePatchPreferences();
  const memberRoles = useMemo(() => new Set((user?.roles ?? []).map((r) => r.role)), [user]);
  const { data: roleData } = useRoleDetails({ enabled: memberRoles.size > 0 });

  // Badge queries key on ['escalations', ...]; one event subscription keeps
  // every badge current (debounce rides React Query's dedupe).
  const qc = useQueryClient();
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.escalation.>`, () => {
    qc.invalidateQueries({ queryKey: ['escalations'] });
  });

  const prefs = prefsQ.data?.preferences;
  const roleDefaults = useMemo(
    () => (roleData?.roles ?? [])
      .filter((r) => memberRoles.has(r.role) && Array.isArray(r.default_pins) && r.default_pins.length > 0)
      .map((r) => ({ role: r.role, pins: r.default_pins as PinnedView[] })),
    [roleData, memberRoles],
  );
  const pins = useMemo(() => resolvePins(prefs, roleDefaults), [prefs, roleDefaults]);

  const ownPins = prefs?.pinnedViews ?? [];
  const dragFrom = useRef<number | null>(null);

  const saveOwn = (next: PinnedView[]) => patch.mutate({ pinnedViews: next });
  const removeOwn = (id: string) => saveOwn(ownPins.filter((p) => p.id !== id));
  const promote = (pin: ResolvedPin) =>
    saveOwn([...ownPins, { id: newPinId(), label: pin.label, url: pin.url, badge: pin.badge }]);
  const hideRolePin = (label: string) =>
    patch.mutate({ hiddenRolePins: [...(prefs?.hiddenRolePins ?? []), label] });
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...ownPins];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveOwn(next);
  };

  if (pins.length === 0) return null;

  return (
    <div className="space-y-1">
      {collapsed ? (
        <div className="h-px bg-surface-border mx-3 my-2" title="Pinned" />
      ) : (
        <p className="px-4 pt-5 pb-2 text-xs font-semibold uppercase tracking-wider text-accent/80">
          Pinned
        </p>
      )}
      {pins.map((pin) => {
        const ownIndex = pin.fromRole ? -1 : ownPins.findIndex((p) => p.id === pin.id);
        return (
          <PinnedItem
            key={pin.id}
            pin={pin}
            collapsed={collapsed}
            draggable={ownIndex !== -1}
            onDragStart={() => { dragFrom.current = ownIndex; }}
            onDropOn={() => {
              if (dragFrom.current !== null && ownIndex !== -1) reorder(dragFrom.current, ownIndex);
              dragFrom.current = null;
            }}
            onRemove={pin.fromRole ? undefined : () => removeOwn(pin.id)}
            onPromote={pin.fromRole ? () => promote(pin) : undefined}
            onHide={pin.fromRole ? () => hideRolePin(pin.label) : undefined}
          />
        );
      })}
    </div>
  );
}

function PinnedItem({ pin, collapsed, draggable, onDragStart, onDropOn, onRemove, onPromote, onHide }: {
  pin: ResolvedPin;
  collapsed: boolean;
  draggable: boolean;
  onDragStart: () => void;
  onDropOn: () => void;
  onRemove?: () => void;
  onPromote?: () => void;
  onHide?: () => void;
}) {
  const { pathname, search } = useLocation();
  const [entryPath, entrySearch = ''] = pin.url.split('?');
  const isActive = pathname === entryPath && search === (entrySearch ? `?${entrySearch}` : '');
  const base = 'group flex items-center rounded-md transition-colors duration-150';
  const tone = isActive
    ? 'bg-surface-hover text-text-primary font-medium'
    : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover';

  if (collapsed) {
    return (
      <NavLink to={pin.url} className={`${base} ${tone} justify-center w-10 h-10 mx-auto`} title={pin.label}>
        <Pin className="w-5 h-5 shrink-0 text-accent/75" strokeWidth={1.5} />
      </NavLink>
    );
  }

  return (
    <div
      className={`${base} ${tone}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropOn}
    >
      <NavLink to={pin.url} className="flex items-center gap-3 pl-4 py-2 text-sm flex-1 min-w-0">
        <Pin className="w-5 h-5 shrink-0 text-accent/75" strokeWidth={1.5} {...(pin.fromRole ? {} : { fill: 'currentColor', fillOpacity: 0.15 })} />
        <span className="truncate">{pin.label}</span>
        {pin.badge && <PinBadge url={pin.url} />}
        {pin.fromRole && (
          <span className="shrink-0 text-2xs uppercase tracking-wider text-text-quaternary" title={`Provided by the ${pin.fromRole} role`}>
            role
          </span>
        )}
      </NavLink>
      <span className="flex items-center pr-2 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {onPromote && (
          <button onClick={onPromote} title="Make mine — copy into my pins" className="p-1 text-text-quaternary hover:text-accent transition-colors">
            <Plus className="w-3 h-3" />
          </button>
        )}
        {onHide && (
          <button onClick={onHide} title="Hide this role pin" className="p-1 text-text-quaternary hover:text-status-error transition-colors">
            <EyeOff className="w-3 h-3" />
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} title={`Remove "${pin.label}"`} className="p-1 text-text-quaternary hover:text-status-error transition-colors">
            <X className="w-3 h-3" />
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Live count of the pinned query — the same server-side predicate the pin
 * opens onto (limit 1, read total). Renders nothing while loading or when the
 * URL isn't a countable escalations list; errors degrade silently.
 */
function PinBadge({ url }: { url: string }) {
  const spec = useMemo(() => pinBadgeQuery(url), [url]);
  const shared = { limit: 1, staleTime: 15_000 };
  const availableQ = useAvailableEscalations({
    ...(spec?.params ?? {}),
    ...shared,
    enabled: !!spec && spec.available,
  });
  const listQ = useEscalations({
    ...(spec?.params ?? {}),
    ...shared,
    enabled: !!spec && !spec.available,
  });
  if (!spec) return null;
  const q = spec.available ? availableQ : listQ;
  if (q.isError || q.data?.total === undefined) return null;
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-2xs font-semibold tabular-nums">
      {q.data.total}
    </span>
  );
}
