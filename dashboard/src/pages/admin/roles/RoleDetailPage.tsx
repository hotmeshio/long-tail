import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Tag, GitBranch, GitMerge, Network, Trash2, Check, Braces, Users, BookOpen,
} from 'lucide-react';
import {
  useRoleDetails,
  useUpdateRole,
  useDeleteRole,
  useEscalationChains,
  useAddEscalationChain,
  useRemoveEscalationChain,
  type RoleDetail,
} from '../../../api/roles';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RoleMembersSection } from './RoleMembersSection';

// ── Helpers ───────────────────────────────────────────────────────────────────

function safePrettyPrint(value: unknown): string {
  if (value == null) return '';
  return JSON.stringify(value, null, 2);
}

function safeParseJson(text: string): { ok: boolean; value?: Record<string, unknown> } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) return { ok: false };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({
  icon: Icon,
  color,
  label,
  aside,
}: {
  icon: React.ElementType;
  color: string;
  label: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3 pb-2 border-b border-surface-border">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.5} />
        <h2 className="section-h2">{label}</h2>
      </div>
      {aside}
    </div>
  );
}

// ── Escalation section (live-save) ────────────────────────────────────────────

function EscalationSection({ role, allRoles }: { role: RoleDetail; allRoles: RoleDetail[] }) {
  const { data: chainsData } = useEscalationChains();
  const addChain = useAddEscalationChain();
  const removeChain = useRemoveEscalationChain();
  const [newTarget, setNewTarget] = useState('');

  const chains = chainsData?.chains ?? [];
  const targets = useMemo(
    () => chains.filter((c) => c.source_role === role.role).map((c) => c.target_role),
    [chains, role.role],
  );
  const available = useMemo(
    () => allRoles
      .map((r) => r.role)
      .filter((r) => r !== role.role && r !== 'superadmin' && !targets.includes(r)),
    [allRoles, role.role, targets],
  );

  if (role.role === 'superadmin') {
    return <p className="text-[11px] text-text-tertiary">Superadmins can escalate to any role implicitly.</p>;
  }

  return (
    <div className="space-y-3">
      {targets.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">Add a target role to route hand-offs.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {targets.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-surface-sunken rounded font-mono text-text-secondary"
            >
              {t}
              <button
                onClick={() => removeChain.mutate({ source_role: role.role, target_role: t })}
                className="text-text-quaternary hover:text-status-error transition-colors leading-none ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            className="select text-xs font-mono flex-1"
          >
            <option value="">Add target…</option>
            {available.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => {
              if (!newTarget) return;
              addChain.mutate({ source_role: role.role, target_role: newTarget }, { onSuccess: () => setNewTarget('') });
            }}
            disabled={!newTarget || addChain.isPending}
            className="px-2.5 py-1 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {addChain.isPending ? '…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Upstream inputs section (live-save) ───────────────────────────────────────

/**
 * The graph edges that don't fit the line. Prior Step (parent_role) places
 * this role in ONE sequence on the Operations page; upstream inputs declare
 * the roles it also draws from in OTHER sequences — mixin-like, many allowed.
 * The chart shows them as a merge glyph on the station, never as a bend in
 * the sequence.
 */
function UpstreamSection({ role, allRoles }: { role: RoleDetail; allRoles: RoleDetail[] }) {
  const updateRole = useUpdateRole();
  const [newUpstream, setNewUpstream] = useState('');

  const upstreams = role.upstream_roles ?? [];
  const available = useMemo(
    () => allRoles
      .map((r) => r.role)
      .filter((r) => r !== role.role && r !== 'superadmin' && !upstreams.includes(r)),
    [allRoles, role.role, upstreams],
  );

  const save = (next: string[]) =>
    updateRole.mutate({ role: role.role, upstream_roles: next }, { onSuccess: () => setNewUpstream('') });

  return (
    <div className="space-y-3">
      {upstreams.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">
          Add a role from another sequence that this station draws input from.
          Prior Step sets where this role sits in its own sequence; upstream
          inputs mark the side-quests that land here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {upstreams.map((u) => (
            <span
              key={u}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-surface-sunken rounded font-mono text-text-secondary"
            >
              {u}
              <button
                onClick={() => save(upstreams.filter((x) => x !== u))}
                className="text-text-quaternary hover:text-status-error transition-colors leading-none ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={newUpstream}
            onChange={(e) => setNewUpstream(e.target.value)}
            className="select text-xs font-mono flex-1"
          >
            <option value="">Add upstream input…</option>
            {available.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => { if (newUpstream) save([...upstreams, newUpstream]); }}
            disabled={!newUpstream || updateRole.isPending}
            className="px-2.5 py-1 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {updateRole.isPending ? '…' : 'Add'}
          </button>
        </div>
      )}
      {updateRole.error && (
        <p className="text-[10px] text-status-error">{(updateRole.error as Error).message}</p>
      )}
    </div>
  );
}

// ── Draft state ───────────────────────────────────────────────────────────────

interface Draft {
  title: string;
  description: string;
  ops_visible: boolean;
  parent_role: string;
  metadata_schema: string;
  properties: string;
  sla_minutes: string;
  target_per_hour: string;
  worker_count: string;
  priority_threshold_minutes: string;
  priority_facet: string;
}

function draftFrom(role: RoleDetail): Draft {
  return {
    title: role.title ?? '',
    description: role.description ?? '',
    ops_visible: role.ops_visible,
    parent_role: role.parent_role ?? '',
    metadata_schema: safePrettyPrint(role.metadata_schema),
    properties: safePrettyPrint(role.properties) || '{}',
    sla_minutes: role.sla_minutes != null ? String(role.sla_minutes) : '',
    target_per_hour: role.target_per_hour != null ? String(role.target_per_hour) : '',
    worker_count: role.worker_count != null ? String(role.worker_count) : '',
    priority_threshold_minutes: role.priority_threshold_minutes != null ? String(role.priority_threshold_minutes) : '',
    priority_facet: role.priority_facet ?? '',
  };
}

// Mirrors the server-side facet key rule (metadata keys are interpolated as a
// JSON path, so they are strictly validated).
const FACET_KEY = /^[a-zA-Z0-9_]+$/;

// ── Page ──────────────────────────────────────────────────────────────────────

export function RoleDetailPage() {
  const { role: roleKey } = useParams<{ role: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useRoleDetails();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();

  const roles = data?.roles ?? [];
  const role = roles.find((r) => r.role === roleKey);

  const [draft, setDraft] = useState<Draft>({
    title: '', description: '', ops_visible: false, parent_role: '',
    metadata_schema: '', properties: '{}',
    sla_minutes: '', target_per_hour: '', worker_count: '',
    priority_threshold_minutes: '', priority_facet: '',
  });
  const [dirty, setDirty] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [errors, setErrors] = useState<{ metadata_schema?: string; properties?: string; priority_facet?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingJson, setEditingJson] = useState(new Set<string>());

  const startEditingJson = (field: string) => setEditingJson((prev) => new Set([...prev, field]));

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

  const availableParents = useMemo(
    () => roles.filter((r) => {
      if (!role || r.role === role.role) return false;
      let cur: RoleDetail | undefined = r;
      const seen = new Set<string>();
      while (cur?.parent_role) {
        if (cur.parent_role === role.role) return false;
        if (seen.has(cur.parent_role)) break;
        seen.add(cur.parent_role);
        cur = roles.find((x) => x.role === cur!.parent_role);
      }
      return true;
    }),
    [roles, role],
  );

  const handleSave = () => {
    const metaResult = safeParseJson(draft.metadata_schema);
    const propsResult = safeParseJson(draft.properties);
    const facet = draft.priority_facet.trim();
    const newErrors: typeof errors = {};
    if (!metaResult.ok) newErrors.metadata_schema = 'Invalid JSON';
    if (!propsResult.ok) newErrors.properties = 'Invalid JSON';
    if (facet && !FACET_KEY.test(facet)) newErrors.priority_facet = 'Letters, numbers, underscores only';
    setErrors(newErrors);
    if (Object.keys(newErrors).length || !role) return;

    const parseNum = (s: string) => { const v = parseFloat(s); return isNaN(v) ? null : v; };
    // Staff counts are whole people/machines — round rather than persist 2.5 workers.
    const parseCount = (s: string) => { const v = parseNum(s); return v == null ? null : Math.round(v); };

    updateRole.mutate(
      {
        role: role.role,
        title: draft.title.trim() || null,
        description: draft.description.trim() || null,
        ops_visible: draft.ops_visible,
        parent_role: draft.parent_role || null,
        metadata_schema: metaResult.value ?? null,
        properties: propsResult.value ?? {},
        sla_minutes: parseNum(draft.sla_minutes),
        target_per_hour: parseNum(draft.target_per_hour),
        worker_count: parseCount(draft.worker_count),
        priority_threshold_minutes: parseNum(draft.priority_threshold_minutes),
        priority_facet: facet || null,
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

  const handleDelete = () => {
    if (!role) return;
    deleteRole.mutate(role.role, { onSuccess: () => navigate('/admin/roles') });
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
        <Tag className="w-12 h-12 text-text-quaternary mb-4" strokeWidth={1} />
        <h2 className="text-lg font-medium text-text-primary mb-2">Role not found</h2>
      </div>
    );
  }

  const inUse = role.user_count > 0 || role.chain_count > 0 || role.workflow_count > 0;
  const canSave = dirty && !Object.values(errors).some(Boolean);

  // Any two capacity settings derive the third — hint the missing one.
  const sla = parseFloat(draft.sla_minutes);
  const tph = parseFloat(draft.target_per_hour);
  const wc = parseFloat(draft.worker_count);
  const slaOk = !isNaN(sla) && sla > 0;
  const tphOk = !isNaN(tph) && tph > 0;
  const wcOk = !isNaN(wc) && wc > 0;
  const derivedCapacityHint =
    slaOk && wcOk && !tphOk ? `→ target ≈ ${(wc / (sla / 60)).toFixed(1)}/h` :
    slaOk && tphOk && !wcOk ? `→ workers ≈ ${(tph * (sla / 60)).toFixed(1)}` :
    tphOk && wcOk && !slaOk ? `→ SLA ≈ ${(wc / tph * 60).toFixed(0)}m` : null;

  return (
    <div>
      {/* ── Header: mirrors the three-column body grid so each section sits
          exactly atop its column — identity + ops · capacity · priority + actions ── */}
      <div className="grid grid-cols-3 gap-16 items-center mb-12">
        {/* Col 1: identity, with the Ops toggle at the column's right edge */}
        <div className="flex items-center justify-between gap-4 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <Tag className="w-5 h-5 text-accent" strokeWidth={1.5} />
              <h1 className="text-lg font-mono font-medium text-text-primary">{role.role}</h1>
              <button
                onClick={() => { window.location.hash = '#docs:dashboard.md:role-detail'; }}
                className="text-text-quaternary hover:text-accent transition-colors"
                title="Open docs for this page"
              >
                <BookOpen className="w-4 h-4" strokeWidth={1.5} />
              </button>
              {role.parent_role && (
                <span className="flex items-center gap-1 text-[10px] text-text-quaternary font-mono">
                  <GitBranch className="w-3 h-3" /> {role.parent_role}
                </span>
              )}
            </div>
            {role.title && <p className="text-sm text-text-secondary pl-8">{role.title}</p>}
          </div>

          {/* Ops — this role is (or isn't) a station on the Pace Board */}
          <div className="flex items-center gap-2 shrink-0" title="Show as a station on the Pace Board">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Ops</span>
            <button
              onClick={() => update({ ops_visible: !draft.ops_visible })}
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                draft.ops_visible ? 'bg-accent' : 'bg-surface-border'
              }`}
            >
              <span
                className={`absolute top-[3px] left-0 w-3.5 h-3.5 rounded-full bg-white transition-transform shadow ${
                  draft.ops_visible ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Col 2: capacity — full column width, settings centered atop the
            column below. Any two settings derive the third. */}
        <div
          className="flex items-end justify-center gap-4 bg-surface-sunken rounded-lg px-4 py-2.5 w-full"
          title="throughput = workers / (sla / 60)"
        >
          {[
            { key: 'sla_minutes' as const,      label: 'SLA',     unit: 'min', placeholder: '30' },
            { key: 'target_per_hour' as const,  label: 'Target',  unit: '/h',  placeholder: '20' },
            { key: 'worker_count' as const,     label: 'Workers', unit: '',    placeholder: '4' },
          ].map(({ key, label, unit, placeholder }) => (
            <div key={key}>
              <label className="block text-[9px] font-semibold uppercase tracking-widest text-text-quaternary mb-1">
                {label}
                {unit && <span className="normal-case font-normal ml-1">{unit}</span>}
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={draft[key]}
                onChange={(e) => update({ [key]: e.target.value })}
                placeholder={placeholder}
                className="input text-xs w-16 font-mono"
              />
            </div>
          ))}
          {derivedCapacityHint && (
            <span className="text-[10px] text-accent font-mono whitespace-nowrap pb-2">
              {derivedCapacityHint}
            </span>
          )}
        </div>

        {/* Col 3: priority left-aligned to the column edge, actions at the right.
            Pending unclaimed items older than the threshold appear as the Pace
            Board priority count, ordered by the facet for the pull. */}
        <div className="flex items-center justify-between gap-4 min-w-0">
          <div
            className="flex items-end gap-4 bg-surface-sunken rounded-lg px-4 py-2.5 shrink-0"
            title="Pending unclaimed items older than the threshold count as priority on the Pace Board. Age is measured from the metadata facet (an ISO 8601 UTC timestamp, e.g. authorized_at) or from created_at when the facet is blank; the threshold falls back to SLA when blank."
          >
            <div>
              <label className="block text-[9px] font-semibold uppercase tracking-widest text-text-quaternary mb-1">
                Priority
                <span className="normal-case font-normal ml-1">min</span>
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={draft.priority_threshold_minutes}
                onChange={(e) => update({ priority_threshold_minutes: e.target.value })}
                placeholder={draft.sla_minutes || '60'}
                className="input text-xs w-16 font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] font-semibold uppercase tracking-widest text-text-quaternary mb-1">
                Facet
              </label>
              <input
                type="text"
                value={draft.priority_facet}
                onChange={(e) => update({ priority_facet: e.target.value })}
                placeholder="created_at"
                className="input text-xs w-28 font-mono"
              />
              {errors.priority_facet && (
                <p className="text-[9px] text-status-error mt-0.5">{errors.priority_facet}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {savedOk && (
              <span className="flex items-center gap-1 text-xs text-status-success animate-page-enter">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
            {updateRole.error && (
              <span className="text-xs text-status-error max-w-[180px] truncate">
                {(updateRole.error as Error).message}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave || updateRole.isPending}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updateRole.isPending ? 'Saving…' : 'Save'}
            </button>
            {!inUse && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-1.5 text-xs rounded-md text-status-error/60 hover:text-status-error hover:bg-status-error/10 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Three-column body ── */}
      <div className="grid grid-cols-3 gap-16 items-start">

        {/* ── Col 1: Identity ── */}
        <div className="space-y-14">

          {/* Identity */}
          <div className="space-y-8">
            <SectionHead icon={Tag} color="text-accent" label="Identity" />

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder={`e.g., ${role.role.charAt(0).toUpperCase() + role.role.slice(1)}`}
                className="input text-sm w-full"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
                Description
              </label>
              <textarea
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="A short description shown on role cards and in the operations view."
                rows={4}
                className="input text-sm w-full resize-none"
              />
            </div>
          </div>

          {/* Sequence placement — only meaningful for stations, so these two
              sections follow the Ops toggle, easing in and out with it. */}
          <div
            className={`space-y-14 overflow-hidden transition-all duration-300 ease-out ${
              draft.ops_visible ? 'opacity-100 max-h-[900px]' : 'opacity-0 max-h-0 pointer-events-none'
            }`}
            aria-hidden={!draft.ops_visible}
          >
            {/* Prior Step */}
            <div className="space-y-5">
              <SectionHead icon={GitBranch} color="text-text-tertiary" label="Prior Step" />
              <select
                value={draft.parent_role}
                onChange={(e) => update({ parent_role: e.target.value })}
                className="select text-sm w-full font-mono"
              >
                <option value="">None — root process</option>
                {availableParents.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.title ? `${r.role} — ${r.title}` : r.role}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-text-tertiary leading-relaxed">
                Places this role in one Pace Board sequence. A role with no prior
                step starts its own sequence.
              </p>
            </div>

            {/* Upstream inputs — cross-sequence graph edges, live-save */}
            <div className="space-y-5">
              <SectionHead
                icon={GitMerge}
                color="text-text-tertiary"
                label="Upstream Inputs"
                aside={
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full dot-ring bg-status-success" />
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-status-success">Live</span>
                  </div>
                }
              />
              <UpstreamSection role={role} allRoles={roles} />
            </div>
          </div>

        </div>

        {/* ── Col 2: Routing & People ── */}
        <div className="space-y-14">

          {/* Escalation targets — live */}
          <div>
            <SectionHead
              icon={Network}
              color="text-text-quaternary"
              label="Escalation Targets"
              aside={
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full dot-ring bg-status-success" />
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-status-success">Live</span>
                </div>
              }
            />
            <EscalationSection role={role} allRoles={roles} />
          </div>

          {/* Members — who can see through this window, and how far */}
          <div className="pt-3 pb-4 border-t border-surface-border/40">
            <SectionHead
              icon={Users}
              color="text-text-quaternary"
              label="Members"
              aside={
                <span className="text-[9px] font-normal normal-case text-text-quaternary">
                  read = what appears · write = what they can act on
                </span>
              }
            />
            <RoleMembersSection role={role.role} />
          </div>
        </div>

        {/* ── Col 3: Schemas & Properties ── */}
        <div className="space-y-14">
          {/* Escalation Schema — versioned, edited on its own page */}
          <div>
            <SectionHead
              icon={Braces}
              color="text-accent"
              label="Escalation Schema"
              aside={
                role.current_schema_version != null ? (
                  <span className="text-[9px] font-mono text-text-quaternary">v{role.current_schema_version} in use</span>
                ) : undefined
              }
            />
            <p className="text-[10px] text-text-tertiary mb-3 leading-relaxed">
              The form a person completes to resolve this role's escalations.
              Versioned — each save adds one; workflows pin any version via{' '}
              <code className="font-mono">schemaVersion</code>.
            </p>
            <Link
              to={`/admin/roles/${encodeURIComponent(role.role)}/schema`}
              className="text-xs text-accent hover:underline"
            >
              {role.form_schema
                ? `Open schema editor — v${role.current_schema_version ?? 1} in use →`
                : 'Define the escalation form →'}
            </Link>
          </div>

          {/* Metadata Schema */}
          <div>
            <SectionHead
              icon={Braces}
              color="text-accent"
              label="Metadata Schema"
              aside={
                !editingJson.has('metadata_schema') && role.metadata_schema ? (
                  <button onClick={() => startEditingJson('metadata_schema')} className="text-[9px] text-accent hover:underline">Edit</button>
                ) : undefined
              }
            />
            <p className="text-[10px] text-text-tertiary mb-3 leading-relaxed">
              Validates <code className="font-mono">metadata</code> at creation time. Keys appear in faceted search autocomplete.
            </p>
            {!editingJson.has('metadata_schema') && role.metadata_schema ? (
              <JsonViewer data={role.metadata_schema} />
            ) : (
              <>
                <textarea
                  value={draft.metadata_schema}
                  onChange={(e) => {
                    const val = e.target.value;
                    update({ metadata_schema: val });
                    setErrors((prev) => ({ ...prev, metadata_schema: safeParseJson(val).ok ? undefined : 'Invalid JSON' }));
                  }}
                  rows={10}
                  spellCheck={false}
                  className="input text-xs font-mono w-full resize-y"
                  placeholder={'{\n  "type": "object",\n  "properties": {\n    "order_id": { "type": "string" }\n  },\n  "required": ["order_id"]\n}'}
                />
                {errors.metadata_schema && <p className="text-[10px] text-status-error mt-1">{errors.metadata_schema}</p>}
              </>
            )}
          </div>

          {/* Properties (free bag) */}
          <div>
            <SectionHead
              icon={Braces}
              color="text-text-quaternary"
              label="Properties"
              aside={
                !editingJson.has('properties') && role.properties && Object.keys(role.properties).length > 0 ? (
                  <button onClick={() => startEditingJson('properties')} className="text-[9px] text-accent hover:underline">Edit</button>
                ) : (
                  <span className="text-[9px] font-normal normal-case text-text-quaternary">custom JSON</span>
                )
              }
            />
            {!editingJson.has('properties') && role.properties && Object.keys(role.properties).length > 0 ? (
              <JsonViewer data={role.properties} defaultCollapsed />
            ) : (
              <>
                <textarea
                  value={draft.properties}
                  onChange={(e) => {
                    const val = e.target.value;
                    update({ properties: val });
                    setErrors((prev) => ({ ...prev, properties: safeParseJson(val).ok ? undefined : 'Invalid JSON' }));
                  }}
                  rows={5}
                  spellCheck={false}
                  className="input text-xs font-mono w-full resize-none"
                  placeholder={'{\n  "icon": "wrench",\n  "color": "#6366f1"\n}'}
                />
                {errors.properties && <p className="text-[10px] text-status-error mt-1">{errors.properties}</p>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Delete confirmation ── */}
      <ConfirmDeleteModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete Role"
        description={
          <>
            Delete role <span className="font-medium font-mono text-text-primary">{role.role}</span>? This cannot be undone.
          </>
        }
        isPending={deleteRole.isPending}
        error={deleteRole.error as Error | null}
      />
    </div>
  );
}
