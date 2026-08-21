import { useMemo, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Pin, X, EyeOff, Plus } from 'lucide-react';
import { useSidebar } from '../../hooks/useSidebar';
import { useAuth } from '../../hooks/useAuth';
import { useRoleDetails } from '../../api/roles';
import { usePreferences, usePatchPreferences, type PinnedView } from '../../api/preferences';
import { useEscalations, useAvailableEscalations } from '../../api/escalations';
import { useEventSubscriptions } from '../../hooks/useEventContext';
import { useMemberEscalationPatterns } from '../../hooks/useMemberEscalationPatterns';
import { useThrottledInvalidation } from '../../hooks/useEventHooks';
import { displayRoleTitle } from '../../lib/role-display';
import { resolvePins, pinBadgeQuery, newPinId, type ResolvedPin } from '../../lib/pinned-views';

/**
 * "Pinned" — the persona's exact queries, one click away. The user's own pins
 * lead (drag to reorder, ✕ to remove); role-provided defaults follow GROUPED
 * by their role's display title — the same composition the persona config
 * screen previews. A group label only exists over visible pins (a role whose
 * pins are all hidden or promoted contributes no label), and pins never
 * indent under it — the label is a caption, not a tree level. Badges are live
 * counts of the pinned query itself, refreshed by escalation events — never
 * polled.
 */
export function PinnedViewsSidebar() {
  const { collapsed } = useSidebar();
  const { user } = useAuth();
  const prefsQ = usePreferences();
  const patch = usePatchPreferences();
  const memberRoles = useMemo(() => new Set((user?.roles ?? []).map((r) => r.role)), [user]);
  const { data: roleData } = useRoleDetails({ enabled: memberRoles.size > 0 });

  // Badge queries key on ['escalations', ...]; the member-role union keeps
  // every badge current — pins can only point at queues the viewer can read.
  // Badges are aggregate surfaces, so the SUMMARY tier bounds the rate.
  const invalidate = useThrottledInvalidation('SUMMARY');
  useEventSubscriptions(useMemberEscalationPatterns(), () => {
    invalidate([['escalations']]);
  });

  const prefs = prefsQ.data?.preferences;
  const roleDefaults = useMemo(
    () => (roleData?.roles ?? [])
      .filter((r) => memberRoles.has(r.role) && Array.isArray(r.default_pins) && r.default_pins.length > 0)
      .map((r) => ({ role: r.role, pins: r.default_pins as PinnedView[] })),
    [roleData, memberRoles],
  );
  const pins = useMemo(() => resolvePins(prefs, roleDefaults), [prefs, roleDefaults]);

  // Role pins group under their role's display title, in role order. Only
  // groups with visible pins render — hidden/promoted pins never leave an
  // orphan label behind.
  const titleByRole = useMemo(
    () => new Map((roleData?.roles ?? []).map((r) => [r.role, displayRoleTitle(r)])),
    [roleData],
  );
  const ownResolved = useMemo(() => pins.filter((p) => !p.fromRole), [pins]);
  const groups = useMemo(
    () => roleDefaults
      .map(({ role }) => ({
        role,
        title: titleByRole.get(role) ?? role,
        pins: pins.filter((p) => p.fromRole === role),
      }))
      .filter((g) => g.pins.length > 0),
    [roleDefaults, titleByRole, pins],
  );

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

  // Each group is a first-class nav section — the same heading recipe as
  // Monitor/Orchestrate/Storage. No "Pinned" umbrella; the role names ARE
  // the categories. Own pins, when present, form their own leading section.
  const sectionHeading =
    'px-4 pt-5 pb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary truncate';

  return (
    <div className="space-y-1">
      {collapsed && <div className="h-px bg-surface-border mx-3 my-2" title="Pinned" />}

      {/* Own pins lead — the user's order, not a role's. */}
      {!collapsed && ownResolved.length > 0 && (
        <p className={sectionHeading}>Pinned</p>
      )}
      {ownResolved.map((pin) => {
        const ownIndex = ownPins.findIndex((p) => p.id === pin.id);
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
            onRemove={() => removeOwn(pin.id)}
          />
        );
      })}

      {/* Role groups — a quiet caption over its pins, never an indent level. */}
      {groups.map((g) => (
        <div key={g.role}>
          {!collapsed && (
            <p
              className={sectionHeading}
              title={`${g.title} — pins from the ${g.role} role`}
              data-testid="pin-group-label"
            >
              {g.title}
            </p>
          )}
          {g.pins.map((pin) => (
            <PinnedItem
              key={pin.id}
              pin={pin}
              collapsed={collapsed}
              draggable={false}
              onDragStart={() => {}}
              onDropOn={() => {}}
              onPromote={() => promote(pin)}
              onHide={() => hideRolePin(pin.label)}
            />
          ))}
        </div>
      ))}
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
      className={`${base} ${tone} relative`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropOn}
    >
      {/* The label owns the full row width — the count rides the right edge
          and the actions are a hover OVERLAY (zero flow width), so nothing
          invisible ever costs the label a character. */}
      <NavLink
        to={pin.url}
        title={pin.label}
        className="flex items-center gap-2.5 pl-4 pr-3 py-1.5 text-[0.7875rem] flex-1 min-w-0"
      >
        <Pin className="w-4 h-4 shrink-0 text-accent/75" strokeWidth={1.5} {...(pin.fromRole ? {} : { fill: 'currentColor', fillOpacity: 0.15 })} />
        <span className="truncate flex-1 min-w-0">{pin.label}</span>
        {pin.badge && <PinBadge url={pin.url} />}
      </NavLink>
      {/* Overlays the row end on hover; its fill matches the hovered row's, so
          it reads as the row revealing tools, not a panel sliding over. */}
      <span className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded px-0.5 bg-surface-hover opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
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
  // Superscript count hugging the row's right edge — bare tabular digits,
  // right aligned so counts read as a column, no pill chrome, no reserved
  // width beyond the digits themselves.
  return (
    <span
      className="shrink-0 text-right text-2xs leading-none tabular-nums text-accent/80 relative -top-[0.35em]"
      title={`${q.data.total} matching now`}
    >
      {q.data.total}
    </span>
  );
}
