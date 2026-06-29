import { useState, useEffect } from 'react';
import {
  Tag, Users, GitBranch, Eye, EyeOff, Network, FileCode, Settings2, Trash2, ChevronRight,
} from 'lucide-react';
import {
  useUpdateRole,
  type RoleDetail,
} from '../../../api/roles';
import { EscalationPanel } from './EscalationPanel';

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'info' | 'escalations' | 'schema' | 'properties';

const TABS: { id: Tab; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'info', label: 'Info', icon: Tag },
  { id: 'escalations', label: 'Escalations', icon: Network },
  { id: 'schema', label: 'Form Schema', icon: FileCode },
  { id: 'properties', label: 'Properties', icon: Settings2 },
];

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
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      return { ok: false };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

// ── Parent chain display ──────────────────────────────────────────────────────

function ParentChain({ role, roles }: { role: RoleDetail; roles: RoleDetail[] }) {
  const chain: string[] = [];
  let current: RoleDetail | undefined = role;
  while (current?.parent_role) {
    const parent = roles.find((r) => r.role === current!.parent_role);
    if (!parent || chain.includes(parent.role)) break;
    chain.unshift(parent.role);
    current = parent;
  }
  if (chain.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chain.map((r, i) => (
        <span key={r} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-text-quaternary" />}
          <span className="text-[10px] text-text-tertiary font-mono">{r}</span>
        </span>
      ))}
      <ChevronRight className="w-2.5 h-2.5 text-text-quaternary" />
      <span className="text-[10px] font-mono font-medium text-text-secondary">{role.role}</span>
    </div>
  );
}

// ── Info tab ──────────────────────────────────────────────────────────────────

function InfoTab({
  role,
  allRoles,
}: {
  role: RoleDetail;
  allRoles: RoleDetail[];
}) {
  const updateRole = useUpdateRole();

  const [title, setTitle] = useState(role.title ?? '');
  const [description, setDescription] = useState(role.description ?? '');
  const [opsVisible, setOpsVisible] = useState(role.ops_visible);
  const [parentRole, setParentRole] = useState(role.parent_role ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTitle(role.title ?? '');
    setDescription(role.description ?? '');
    setOpsVisible(role.ops_visible);
    setParentRole(role.parent_role ?? '');
    setDirty(false);
  }, [role.role]);

  const markDirty = () => setDirty(true);

  const handleSave = () => {
    updateRole.mutate(
      {
        role: role.role,
        title: title.trim() || null,
        description: description.trim() || null,
        ops_visible: opsVisible,
        parent_role: parentRole || null,
      },
      { onSuccess: () => setDirty(false) },
    );
  };

  const availableParents = allRoles.filter((r) => {
    if (r.role === role.role) return false;
    // Prevent cycles: don't allow a role that has this role as an ancestor
    let cur: RoleDetail | undefined = r;
    const seen = new Set<string>();
    while (cur?.parent_role) {
      if (cur.parent_role === role.role) return false;
      if (seen.has(cur.parent_role)) break;
      seen.add(cur.parent_role);
      cur = allRoles.find((x) => x.role === cur!.parent_role);
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Parent chain breadcrumb */}
      <ParentChain role={role} roles={allRoles} />

      {/* Title */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
          Display Name
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); markDirty(); }}
          placeholder={`e.g., ${role.role.charAt(0).toUpperCase() + role.role.slice(1)}`}
          className="input text-sm w-full"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => { setDescription(e.target.value); markDirty(); }}
          placeholder="A short description shown on role cards and in the operations view."
          rows={3}
          className="input text-sm w-full resize-none"
        />
      </div>

      {/* Parent role */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
          Parent Role
          <span className="normal-case font-normal ml-1 text-text-quaternary">— process dependency graph</span>
        </label>
        <select
          value={parentRole}
          onChange={(e) => { setParentRole(e.target.value); markDirty(); }}
          className="select text-sm w-full font-mono"
        >
          <option value="">None (root process)</option>
          {availableParents.map((r) => (
            <option key={r.role} value={r.role}>
              {r.title ? `${r.role} — ${r.title}` : r.role}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-text-quaternary mt-1">
          Sets which process must complete before this one begins.
        </p>
      </div>

      {/* Ops visible */}
      <div className="flex items-start gap-3 pt-1">
        <button
          onClick={() => { setOpsVisible((v) => !v); markDirty(); }}
          className={`mt-0.5 shrink-0 w-8 h-4 rounded-full transition-colors relative ${
            opsVisible ? 'bg-accent' : 'bg-surface-border'
          }`}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow ${
              opsVisible ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div>
          <div className="flex items-center gap-1.5">
            {opsVisible
              ? <Eye className="w-3 h-3 text-accent" />
              : <EyeOff className="w-3 h-3 text-text-quaternary" />}
            <span className="text-sm text-text-primary">
              {opsVisible ? 'Visible in Operations view' : 'Hidden from Operations view'}
            </span>
          </div>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            When enabled, this role appears as a station card on the /operations page.
          </p>
        </div>
      </div>

      {/* Save */}
      {dirty && (
        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={updateRole.isPending}
            className="btn-primary text-xs"
          >
            {updateRole.isPending ? 'Saving…' : 'Save Changes'}
          </button>
          {updateRole.error && (
            <span className="text-xs text-status-error">
              {(updateRole.error as Error).message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Schema tab ────────────────────────────────────────────────────────────────

function SchemaTab({ role }: { role: RoleDetail }) {
  const updateRole = useUpdateRole();
  const [text, setText] = useState(() => safePrettyPrint(role.form_schema));
  const [dirty, setDirty] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setText(safePrettyPrint(role.form_schema));
    setDirty(false);
    setParseError(null);
  }, [role.role]);

  const handleChange = (val: string) => {
    setText(val);
    setDirty(true);
    const result = safeParseJson(val);
    setParseError(result.ok ? null : 'Invalid JSON object');
  };

  const handleSave = () => {
    const result = safeParseJson(text);
    if (!result.ok) return;
    updateRole.mutate(
      { role: role.role, form_schema: result.value ?? null },
      { onSuccess: () => setDirty(false) },
    );
  };

  const handleClear = () => {
    updateRole.mutate({ role: role.role, form_schema: null }, {
      onSuccess: () => { setText(''); setDirty(false); },
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-tertiary leading-relaxed">
        A JSON Schema object that drives the escalation resolve form for this role.
        Workflows can override this with their own <code className="font-mono">resolver_schema</code>.
      </p>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={14}
        spellCheck={false}
        className="input text-xs font-mono w-full resize-y"
        placeholder='{"type":"object","properties":{"notes":{"type":"string","title":"Notes"}}}'
      />
      {parseError && <p className="text-xs text-status-error">{parseError}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || !!parseError || updateRole.isPending}
          className="btn-primary text-xs"
        >
          {updateRole.isPending ? 'Saving…' : 'Save Schema'}
        </button>
        {role.form_schema && (
          <button
            onClick={handleClear}
            disabled={updateRole.isPending}
            className="btn-secondary text-xs"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ── Properties tab ────────────────────────────────────────────────────────────

function PropertiesTab({ role }: { role: RoleDetail }) {
  const updateRole = useUpdateRole();
  const [text, setText] = useState(() => safePrettyPrint(role.properties) || '{}');
  const [dirty, setDirty] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setText(safePrettyPrint(role.properties) || '{}');
    setDirty(false);
    setParseError(null);
  }, [role.role]);

  const handleChange = (val: string) => {
    setText(val);
    setDirty(true);
    const result = safeParseJson(val);
    setParseError(result.ok ? null : 'Invalid JSON object');
  };

  const handleSave = () => {
    const result = safeParseJson(text);
    if (!result.ok) return;
    updateRole.mutate(
      { role: role.role, properties: result.value ?? {} },
      { onSuccess: () => setDirty(false) },
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-tertiary leading-relaxed">
        Open bag for station-specific metadata: SLA targets, icon, color, staffing goals, location.
        Keys used by the /operations view: <code className="font-mono">sla_minutes</code>, <code className="font-mono">target_per_hour</code>, <code className="font-mono">icon</code>.
      </p>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={12}
        spellCheck={false}
        className="input text-xs font-mono w-full resize-y"
        placeholder='{"sla_minutes":30,"target_per_hour":20}'
      />
      {parseError && <p className="text-xs text-status-error">{parseError}</p>}
      <button
        onClick={handleSave}
        disabled={!dirty || !!parseError || updateRole.isPending}
        className="btn-primary text-xs"
      >
        {updateRole.isPending ? 'Saving…' : 'Save Properties'}
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function RoleDetailPanel({
  selectedRole,
  roles,
  onDelete,
}: {
  selectedRole: string;
  roles: RoleDetail[];
  onDelete: (role: RoleDetail) => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>('info');
  const role = roles.find((r) => r.role === selectedRole);
  const allRoleNames = roles.map((r) => r.role);

  if (!role) {
    return (
      <div className="border-l border-surface-border pl-6 min-h-[200px] flex items-center">
        <p className="text-xs text-text-tertiary">Select a role to edit.</p>
      </div>
    );
  }

  const inUse = role.user_count > 0 || role.chain_count > 0 || role.workflow_count > 0;

  return (
    <div className="border-l border-surface-border pl-6 min-h-[400px]">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-mono font-medium text-text-primary">{role.role}</span>
            {role.ops_visible && (
              <span className="inline-flex items-center gap-1 text-[9px] font-medium text-accent uppercase tracking-wider">
                <Eye className="w-2.5 h-2.5" />ops
              </span>
            )}
          </div>
          {role.title && (
            <p className="text-xs text-text-secondary mt-0.5">{role.title}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5">
            <span className="flex items-center gap-1 text-[10px] text-text-quaternary">
              <Users className="w-2.5 h-2.5" />{role.user_count}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-text-quaternary">
              <Network className="w-2.5 h-2.5" />{role.chain_count}
            </span>
            {role.parent_role && (
              <span className="flex items-center gap-1 text-[10px] text-text-quaternary">
                <GitBranch className="w-2.5 h-2.5" />{role.parent_role}
              </span>
            )}
          </div>
        </div>
        {!inUse && (
          <button
            onClick={() => onDelete(role)}
            className="text-text-quaternary hover:text-status-error transition-colors"
            title="Delete role"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-surface-border mb-5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 pb-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'text-accent border-accent'
                : 'text-text-tertiary border-transparent hover:text-text-secondary'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'info' && (
        <InfoTab role={role} allRoles={roles} />
      )}
      {activeTab === 'escalations' && (
        <EscalationPanel selectedRole={selectedRole} allRoles={allRoleNames} embedded />
      )}
      {activeTab === 'schema' && (
        <SchemaTab role={role} />
      )}
      {activeTab === 'properties' && (
        <PropertiesTab role={role} />
      )}
    </div>
  );
}
