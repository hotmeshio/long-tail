import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Tag, Inbox, GitBranch, Check, Braces, Users, BookOpen, LayoutDashboard, Pin as PinIcon,
  MonitorSmartphone,
} from 'lucide-react';
import { useRoleDetails, useUpdateRole } from '../../../api/roles';
import { RoleMembersSection } from './RoleMembersSection';
import {
  EMPTY_DRAFT,
  FACET_KEY,
  SectionGroup,
  Toggle,
  draftFrom,
  safeParseJson,
  readKioskFlag,
  toggleKioskFlag,
  type Draft,
  type DraftErrors,
} from './role-detail-shared';
import { IdentitySection } from './sections/IdentitySection';
import { PaceBoardSection } from './sections/PaceBoardSection';
import { SchemasSection } from './sections/SchemasSection';
import { PinsSection } from './sections/PinsSection';

// ── Sub-nav sections — the role's configuration, organized by concern ─────────

const SECTIONS = [
  { key: 'identity',   label: 'Identity',   icon: Tag },
  { key: 'pace-board', label: 'Pace Board', icon: LayoutDashboard },
  { key: 'schemas',    label: 'Schemas',    icon: Braces },
  { key: 'members',    label: 'Members',    icon: Users },
  { key: 'pins',       label: 'Pins',       icon: PinIcon },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const isSectionKey = (s: string | null): s is SectionKey =>
  SECTIONS.some((x) => x.key === s);

// ── Page ──────────────────────────────────────────────────────────────────────

export function RoleDetailPage() {
  const { role: roleKey } = useParams<{ role: string }>();
  const { data, isLoading } = useRoleDetails();
  const updateRole = useUpdateRole();

  const roles = data?.roles ?? [];
  const role = roles.find((r) => r.role === roleKey);

  // ONE draft across every section — switching sections never loses edits.
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [editingJson, setEditingJson] = useState(new Set<string>());

  const startEditingJson = (field: string) => setEditingJson((prev) => new Set([...prev, field]));

  // Active section rides the URL (?section=pace-board) so deep links land on
  // the exact concern — the Operations gear opens straight to the board dials.
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const section: SectionKey = isSectionKey(sectionParam) ? sectionParam : 'identity';
  const setSection = useCallback((s: SectionKey) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('section', s);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (!role) return;
    setDraft(draftFrom(role));
    setDirty(false);
    setSavedOk(false);
    setErrors({});
    setEditingJson(new Set());
  }, [roleKey, role?.role]);

  const update = (changes: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...changes }));
    setDirty(true);
    setSavedOk(false);
  };

  const handleSave = () => {
    if (!role) return;
    const metaResult = safeParseJson(draft.metadata_schema);
    const propsResult = safeParseJson(draft.properties);
    const facet = draft.priority_facet.trim();
    const entityFacet = draft.entity_facet.trim();
    const newErrors: DraftErrors = {};
    if (!metaResult.ok) newErrors.metadata_schema = 'Invalid JSON';
    if (!propsResult.ok) newErrors.properties = 'Invalid JSON';
    if (facet && !FACET_KEY.test(facet)) newErrors.priority_facet = 'Letters, numbers, underscores only';
    if (entityFacet && !FACET_KEY.test(entityFacet)) newErrors.entity_facet = 'Letters, numbers, underscores only';
    setErrors(newErrors);
    if (Object.keys(newErrors).length) return;

    const parseNum = (s: string) => { const v = parseFloat(s); return isNaN(v) ? null : v; };
    // Staff counts are whole people/machines — round rather than persist 2.5 workers.
    const parseCount = (s: string) => { const v = parseNum(s); return v == null ? null : Math.round(v); };

    updateRole.mutate(
      {
        role: role.role,
        title: draft.title.trim() || null,
        description: draft.description.trim() || null,
        ops_visible: draft.ops_visible,
        ops_home_default: draft.ops_home_default,
        enforce_schema: draft.enforce_schema,
        parent_role: draft.parent_role || null,
        metadata_schema: metaResult.value ?? null,
        properties: propsResult.value ?? {},
        sla_minutes: parseNum(draft.sla_minutes),
        target_per_hour: parseNum(draft.target_per_hour),
        worker_count: parseCount(draft.worker_count),
        priority_threshold_minutes: parseNum(draft.priority_threshold_minutes),
        priority_facet: facet || null,
        entity_facet: entityFacet || null,
        entity_state_source: draft.entity_state_source,
      },
      {
        onSuccess: () => {
          setDirty(false);
          setSavedOk(true);
          setEditingJson(new Set());
          window.setTimeout(() => setSavedOk(false), 2500);
        },
      },
    );
  };

  // ── Loading / not found ───────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-4 bg-surface-sunken rounded w-64" />
        <div className="h-64 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Inbox className="w-12 h-12 text-text-quaternary mb-4" strokeWidth={1} />
        <h2 className="heading-3 mb-2">Role not found</h2>
      </div>
    );
  }

  const canSave = dirty && !Object.values(errors).some(Boolean);

  return (
    <div>
      {/* ── Header: identity only — every control lives in a section ── */}
      <div className="mb-10 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <Inbox className="w-5 h-5 text-accent" strokeWidth={1.5} />
          <h1 className="text-lg font-mono font-medium text-text-primary">{role.role}</h1>
          <button
            onClick={() => { window.location.hash = '#docs:dashboard.md:role-detail'; }}
            className="text-text-quaternary hover:text-accent transition-colors"
            title="Open docs for this page"
          >
            <BookOpen className="w-4 h-4" strokeWidth={1.5} />
          </button>
          {role.parent_role && (
            <span className="flex items-center gap-1 text-2xs text-text-quaternary font-mono">
              <GitBranch className="w-3 h-3" /> {role.parent_role}
            </span>
          )}
        </div>
        {role.title && <p className="text-sm text-text-secondary pl-8">{role.title}</p>}
      </div>

      <div className="flex gap-10">
        {/* Section nav — sticky left sidebar; Save is always in view */}
        <nav className="w-44 shrink-0 sticky top-0 self-start pt-2">
          <div className="space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors ${
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                  <span className="text-xs font-medium">{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Save — one draft, one save, visible from every section */}
          <div className="mt-8 pt-4 border-t border-surface-border space-y-2">
            <button
              onClick={handleSave}
              disabled={!canSave || updateRole.isPending}
              className="w-full px-3 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updateRole.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Save'}
            </button>
            {savedOk && (
              <span className="flex items-center justify-center gap-1 text-xs text-status-success animate-page-enter">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
            {updateRole.error && (
              <p className="text-2xs text-status-error leading-relaxed">
                {(updateRole.error as Error).message}
              </p>
            )}
            {Object.values(errors).some(Boolean) && (
              <p className="text-2xs text-status-error leading-relaxed">
                Fix the highlighted fields before saving.
              </p>
            )}
          </div>
        </nav>

        {/* Section content — readable single-column measure */}
        <div className="flex-1 min-w-0 pt-2 max-w-3xl">
          {section === 'identity' && (
            <IdentitySection role={role} draft={draft} update={update} errors={errors} />
          )}
          {section === 'pace-board' && (
            <PaceBoardSection role={role} allRoles={roles} draft={draft} update={update} errors={errors} />
          )}
          {section === 'schemas' && (
            <SchemasSection
              role={role}
              draft={draft}
              update={update}
              errors={errors}
              editingJson={editingJson}
              startEditingJson={startEditingJson}
              setMetadataSchemaError={(msg) => setErrors((prev) => ({ ...prev, metadata_schema: msg }))}
            />
          )}
          {section === 'members' && (
            <div className="space-y-14">
              <SectionGroup
                icon={Users}
                label="Members"
                annotation="read = what appears · write = what they can act on"
                accent
              >
                <RoleMembersSection role={role.role} />
              </SectionGroup>

              {/* Kiosk — how single-role members experience the dashboard */}
              <SectionGroup
                icon={MonitorSmartphone}
                label="Station Kiosk"
                annotation="the locked viewport for single-role logins"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-text-secondary">Lock single-role members to this queue</p>
                    <p className="text-2xs text-text-tertiary leading-relaxed mt-1">
                      A member who holds only this role signs in to a locked viewport:
                      no side navigation, this queue as home, held to the list, the
                      item detail, and the scan screens. Members with other roles keep
                      the full dashboard.
                    </p>
                  </div>
                  <Toggle
                    checked={readKioskFlag(draft.properties)}
                    onChange={() => {
                      const next = toggleKioskFlag(draft.properties);
                      if (next !== null) update({ properties: next });
                    }}
                    title="Kiosk station viewport"
                  />
                </div>
              </SectionGroup>
            </div>
          )}
          {section === 'pins' && <PinsSection role={role} />}
        </div>
      </div>
    </div>
  );
}
