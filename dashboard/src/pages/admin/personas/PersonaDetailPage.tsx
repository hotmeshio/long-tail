import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Drama, Tag, Inbox, Pin, PanelLeft, BookOpen, Check, Trash2,
} from 'lucide-react';
import {
  usePersona,
  useUpdatePersona,
  useDeletePersona,
  useLinkPersonaRole,
  useUnlinkPersonaRole,
} from '../../../api/personas';
import { useRoleDetails } from '../../../api/roles';
import type { LTPersonaDetail, LTPersonaRelationship } from '../../../api/types';
import { RolePill } from '../../../components/common/display/RolePill';
import { ScopeBadge } from '../../../components/common/display/ScopeBadge';
import { AutoGrowTextarea } from '../../../components/common/form/AutoGrowTextarea';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import {
  RELATIONSHIP_OPTIONS,
  DEFAULT_RELATIONSHIP,
  relationshipOption,
} from '../../../lib/personaRelationship';

// ── Section group — eyebrow (icon + tiny title + annotation) over a left-ruled
//    body. The same single grouping treatment the Role config page uses. ──────

function SectionGroup({
  icon: Icon,
  label,
  annotation,
  accent = false,
  children,
}: {
  icon: React.ElementType;
  label: string;
  annotation?: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  const hue = accent ? 'text-accent' : 'text-text-tertiary';
  return (
    <div>
      <div className="flex items-center gap-1.5 min-w-0 mb-5">
        <Icon className={`w-3 h-3 ${hue} shrink-0`} strokeWidth={1.5} />
        <span className={`text-2xs font-semibold uppercase tracking-widest ${hue}`}>{label}</span>
        {annotation && (
          <span className="text-2xs text-text-quaternary truncate">— {annotation}</span>
        )}
      </div>
      <div className={`border-l-2 pl-5 ${accent ? 'border-accent/15' : 'border-surface-border/60'}`}>
        {children}
      </div>
    </div>
  );
}

const FIELD_LABEL = 'block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5';

// ── Roles — the bundle's rules, live-saved ───────────────────────────────────

function RoleLinksSection({ persona }: { persona: LTPersonaDetail }) {
  const { data: rolesData } = useRoleDetails();
  const linkRole = useLinkPersonaRole();
  const unlinkRole = useUnlinkPersonaRole();
  const [newRole, setNewRole] = useState('');
  const [newRelationship, setNewRelationship] = useState<LTPersonaRelationship>(DEFAULT_RELATIONSHIP);

  const linked = persona.roles ?? [];
  const available = useMemo(() => {
    const set = new Set(linked.map((r) => r.role));
    return (rolesData?.roles ?? []).map((r) => r.role).filter((r) => !set.has(r));
  }, [rolesData, linked]);

  const handleAdd = () => {
    if (!newRole) return;
    linkRole.mutate(
      { key: persona.key, role: newRole, relationship: newRelationship },
      { onSuccess: () => { setNewRole(''); setNewRelationship(DEFAULT_RELATIONSHIP); } },
    );
  };

  return (
    <div className="space-y-2">
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="select text-xs font-mono flex-1 min-w-0"
            aria-label="Role to link"
          >
            <option value="">Add role…</option>
            {available.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            value={newRelationship}
            onChange={(e) => setNewRelationship(e.target.value as LTPersonaRelationship)}
            className="select text-xs shrink-0 w-36"
            aria-label="Relationship"
          >
            {RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!newRole || linkRole.isPending}
            className="px-2.5 py-1 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {linkRole.isPending ? '…' : 'Add'}
          </button>
        </div>
      )}

      {linked.length === 0 ? (
        <p className="text-2xs text-text-tertiary leading-relaxed py-1">
          Add a role above and it lands here. An assignee joins every linked
          role at its relationship scope.
        </p>
      ) : (
        <div className="divide-y divide-surface-border/30">
          {linked.map((r) => {
            const opt = relationshipOption(r.relationship);
            return (
              <div key={r.role} className="flex items-center gap-2.5 py-2 min-w-0 group/link">
                <Link
                  to={`/admin/roles/${encodeURIComponent(r.role)}`}
                  className="min-w-0 flex-1 truncate text-text-secondary transition-colors hover:text-accent"
                  title={r.role}
                >
                  <RolePill role={r.role} tone="inherit" />
                </Link>
                <ScopeBadge read={opt.read_scope} write={opt.write_scope} className="shrink-0" />
                <select
                  value={r.relationship}
                  onChange={(e) =>
                    linkRole.mutate({ key: persona.key, role: r.role, relationship: e.target.value })
                  }
                  className="select text-2xs w-36 shrink-0"
                  aria-label={`Relationship for ${r.role}`}
                >
                  {RELATIONSHIP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => unlinkRole.mutate({ key: persona.key, role: r.role })}
                  className="shrink-0 text-text-quaternary hover:text-status-error transition-colors leading-none"
                  title={`Unlink ${r.role}`}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}

      {(linkRole.error || unlinkRole.error) && (
        <p className="text-2xs text-status-error">
          {((linkRole.error || unlinkRole.error) as Error).message}
        </p>
      )}
    </div>
  );
}

// ── Composed surface — the sidebar an assignee actually gets ─────────────────

function ComposedSurfaceSection({ persona }: { persona: LTPersonaDetail }) {
  const { data: rolesData } = useRoleDetails();

  // The union of the linked roles' default pins, in link order, deduped the way
  // the live sidebar resolves them (first pin wins per label+url).
  const groups = useMemo(() => {
    const byRole = new Map((rolesData?.roles ?? []).map((r) => [r.role, r]));
    const seen = new Set<string>();
    return (persona.roles ?? []).map(({ role }) => {
      const detail = byRole.get(role);
      const pins = (detail?.default_pins ?? []).filter((p) => {
        const id = `${p.label}|${p.url}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return { role, title: detail?.title ?? null, pins };
    });
  }, [rolesData, persona.roles]);

  const pinCount = groups.reduce((n, g) => n + g.pins.length, 0);

  if (persona.roles.length === 0) {
    return (
      <p className="text-2xs text-text-tertiary leading-relaxed">
        Link roles and their pinned views compose here — the sidebar an
        assignee gets the moment the persona lands.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-2xs text-text-quaternary">
        {pinCount} pinned {pinCount === 1 ? 'view' : 'views'} from {groups.length} {groups.length === 1 ? 'role' : 'roles'} — assignment composes this sidebar as-is.
      </p>
      {groups.map((g) => (
        <div key={g.role}>
          <p className="text-2xs font-mono text-text-quaternary mb-1.5 truncate" title={g.role}>
            {g.title || g.role}
          </p>
          {g.pins.length === 0 ? (
            <p className="text-2xs text-text-quaternary/70 pl-4">no pins — set them on the role</p>
          ) : (
            <div className="space-y-0.5">
              {g.pins.map((p) => (
                <Link
                  key={`${p.label}|${p.url}`}
                  to={p.url}
                  className="flex items-center gap-2 py-1 pl-1 pr-2 rounded-md text-xs text-text-secondary hover:text-accent hover:bg-surface-hover/50 transition-colors min-w-0 group/pin"
                  title={p.url}
                >
                  <Pin className="w-3 h-3 shrink-0 text-text-quaternary group-hover/pin:text-accent transition-colors" strokeWidth={1.5} />
                  <span className="truncate flex-1 min-w-0">{p.label}</span>
                  {p.badge && (
                    <span
                      className="w-2.5 h-2.5 rounded-full dot-ring bg-status-pending-graphic shrink-0"
                      title="Carries a live count"
                    />
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PersonaDetailPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { data: persona, isLoading } = usePersona(key);
  const updatePersona = useUpdatePersona();
  const deletePersona = useDeletePersona();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  // Identity draft, loaded once per persona key.
  const [draft, setDraft] = useState({ title: '', description: '' });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (persona && loadedKey !== persona.key) {
    setLoadedKey(persona.key);
    setDraft({ title: persona.title ?? '', description: persona.description ?? '' });
  }

  const dirty = !!persona && (
    draft.title !== (persona.title ?? '') || draft.description !== (persona.description ?? '')
  );

  const handleSave = () => {
    if (!persona) return;
    updatePersona.mutate(
      {
        key: persona.key,
        title: draft.title.trim() || null,
        description: draft.description.trim() || null,
      },
      {
        onSuccess: () => {
          setSavedOk(true);
          setTimeout(() => setSavedOk(false), 2000);
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 mt-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-surface-sunken rounded w-full" />
        ))}
      </div>
    );
  }

  if (!persona) {
    return <p className="text-sm text-text-tertiary mt-8">Persona '{key}' not found.</p>;
  }

  return (
    <div>
      {/* ── Header — identity on the left, save state and actions on the right,
          the same working header the Role config page carries. ─────────────── */}
      <div className="flex items-center justify-between gap-4 mb-12 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Drama className="w-5 h-5 text-accent" strokeWidth={1.5} />
            <h1 className="text-lg font-mono font-medium text-text-primary truncate">{persona.key}</h1>
            <button
              onClick={() => { window.location.hash = '#docs:dashboard.md:personas'; }}
              className="text-text-quaternary hover:text-accent transition-colors"
              title="Open docs for this page"
            >
              <BookOpen className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
          {persona.title && <p className="text-sm text-text-secondary pl-8 truncate">{persona.title}</p>}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {savedOk && (
            <span className="flex items-center gap-1 text-xs text-status-success animate-page-enter">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
          {updatePersona.error && (
            <span className="text-xs text-status-error max-w-[180px] truncate">
              {(updatePersona.error as Error).message}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || updatePersona.isPending}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {updatePersona.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-3 py-1.5 text-xs rounded-md text-status-error/60 hover:text-status-error hover:bg-status-error/10 transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      </div>

      {/* ── Three-column body: identity · the bundle · what it composes ────── */}
      <div className="grid grid-cols-3 gap-16 items-start">

        <SectionGroup icon={Tag} label="Identity" annotation="name and story" accent>
          <div className="space-y-8">
            <div>
              <label className={FIELD_LABEL}>Display Title</label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="e.g., Production Manager"
                className="input text-sm w-full"
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>Description</label>
              <AutoGrowTextarea
                value={draft.description}
                onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
                placeholder="The day in the life, one paragraph — shown wherever the persona is offered."
                rows={3}
              />
            </div>
          </div>
        </SectionGroup>

        <SectionGroup icon={Inbox} label="Roles" annotation="membership, each at a scope" accent>
          <RoleLinksSection persona={persona} />
        </SectionGroup>

        <SectionGroup icon={PanelLeft} label="Composed Surface" annotation="the assignee's sidebar">
          <ComposedSurfaceSection persona={persona} />
        </SectionGroup>
      </div>

      <ConfirmDeleteModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          deletePersona.mutate(persona.key, {
            onSuccess: () => navigate('/admin/personas'),
          })
        }
        title="Delete Persona"
        description={
          <>
            Delete{' '}
            <span className="font-medium text-text-primary">{persona.title || persona.key}</span>
            ? Memberships it sustains are removed; direct grants are kept.
          </>
        }
        isPending={deletePersona.isPending}
        error={deletePersona.error as Error | null}
      />
    </div>
  );
}
