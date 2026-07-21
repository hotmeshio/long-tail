import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Braces, Check, History, BookOpen } from 'lucide-react';
import {
  useRoleDetails,
  useRoleSchema,
  useRoleSchemaVersions,
  useUpdateRole,
  type RoleSchemaVersionSummary,
} from '../../../api/roles';
import { JsonViewer } from '../../../components/common/data/JsonViewer';

/**
 * The escalation form schema, on its own page (/admin/roles/:role/schema).
 * This is the form a person completes to resolve the role's escalations —
 * versioned, pinnable by workflows (conditionLT schemaVersion), and worth a
 * full editing surface. Saving here writes ONLY the schema: one PATCH with
 * form_schema (+ optional change summary); every actual change appends the
 * next immutable version.
 */

const PLACEHOLDER = `{
  "type": "object",
  "properties": {
    "approved": { "type": "boolean", "title": "Approve?" },
    "notes": { "type": "string", "title": "Notes" }
  },
  "required": ["approved"]
}`;

function safeParseObject(text: string): { ok: boolean; value?: Record<string, unknown> | null } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) return { ok: false };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

export function EscalationSchemaPage() {
  const { role: roleKey } = useParams<{ role: string }>();
  const { data, isLoading } = useRoleDetails();
  const updateRole = useUpdateRole();

  const role = (data?.roles ?? []).find((r) => r.role === roleKey);

  const [text, setText] = useState('');
  const [summary, setSummary] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [jsonError, setJsonError] = useState(false);

  // Seed the editor from the live schema exactly once per role — refetches
  // (cache invalidations, saves) must not clobber in-progress edits.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!role || seededFor.current === role.role) return;
    seededFor.current = role.role;
    setText(role.form_schema ? JSON.stringify(role.form_schema, null, 2) : '');
    setSummary('');
    setDirty(false);
    setJsonError(false);
  }, [role]);

  const handleEdit = (value: string) => {
    setText(value);
    setDirty(true);
    setSavedOk(false);
    setJsonError(!safeParseObject(value).ok);
  };

  const handleSave = () => {
    const parsed = safeParseObject(text);
    if (!parsed.ok || !role) { setJsonError(!parsed.ok); return; }
    // Saving just the schema — nothing else rides this PATCH.
    updateRole.mutate(
      { role: role.role, form_schema: parsed.value ?? null, change_summary: summary.trim() || undefined },
      {
        onSuccess: () => {
          setDirty(false);
          setSavedOk(true);
          setSummary('');
          window.setTimeout(() => setSavedOk(false), 2500);
        },
      },
    );
  };

  const loadIntoEditor = (schema: Record<string, unknown> | null) => {
    setText(schema ? JSON.stringify(schema, null, 2) : '');
    setDirty(true);
    setSavedOk(false);
    setJsonError(false);
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-64" />
        <div className="h-96 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Braces className="w-12 h-12 text-text-quaternary mb-4" strokeWidth={1} />
        <h2 className="text-lg font-medium text-text-primary mb-2">Role not found</h2>
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Braces className="w-5 h-5 text-accent" strokeWidth={1.5} />
            <h1 className="text-lg font-medium text-text-primary">Escalation Schema</h1>
            <button
              onClick={() => { window.location.hash = '#docs:dashboard.md:escalation-schema'; }}
              className="text-text-quaternary hover:text-accent transition-colors"
              title="Open docs for this page"
            >
              <BookOpen className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="font-mono text-sm text-text-tertiary">{role.role}</span>
            {role.current_schema_version != null && (
              <span className="text-2xs font-mono text-text-quaternary">
                v{role.current_schema_version} in use
              </span>
            )}
          </div>
          <button
            onClick={() => { window.location.hash = '#docs:hitl-guide.md:json-schema-form-authoring'; }}
            className="text-2xs text-accent hover:underline pl-8"
          >
            Form authoring reference — field types, widgets, and every x-lt-* keyword →
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {savedOk && (
            <span className="flex items-center gap-1 text-xs text-status-success animate-page-enter">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
          {updateRole.error && (
            <span className="text-xs text-status-error max-w-[220px] truncate">
              {(updateRole.error as Error).message}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || jsonError || updateRole.isPending}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {updateRole.isPending ? 'Saving…' : 'Save Version'}
          </button>
        </div>
      </div>

      {/* ── Editor + version rail ── */}
      <div className="grid grid-cols-3 gap-16 items-start">
        <div className="col-span-2 space-y-6">
          <textarea
            value={text}
            onChange={(e) => handleEdit(e.target.value)}
            rows={28}
            spellCheck={false}
            className="input text-xs font-mono w-full resize-y leading-relaxed"
            placeholder={PLACEHOLDER}
          />
          {jsonError && <p className="text-2xs text-status-error -mt-4">Invalid JSON</p>}

          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
              Change Summary
            </label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g., Added lotNumber field for shoe orders"
              className="input text-sm w-full"
            />
            <p className="text-2xs text-text-quaternary mt-1.5">
              Recorded on the version this save creates.
            </p>
          </div>
        </div>

        {/* Version history — view any snapshot, load one as the editing base */}
        <div>
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-surface-border">
            <History className="w-4 h-4 text-text-quaternary" strokeWidth={1.5} />
            <h2 className="section-h2">Versions</h2>
          </div>
          <VersionRail role={role.role} onLoad={loadIntoEditor} />
        </div>
      </div>
    </div>
  );
}

function VersionRail({
  role,
  onLoad,
}: {
  role: string;
  onLoad: (schema: Record<string, unknown> | null) => void;
}) {
  const { data } = useRoleSchemaVersions(role);
  const versions = data?.versions ?? [];

  if (versions.length === 0) {
    return (
      <p className="text-2xs text-text-tertiary leading-relaxed">
        Versions appear here after the first save. Each schema change adds one;
        earlier versions stay viewable and loadable as an editing base.
      </p>
    );
  }

  return (
    <div className="divide-y divide-surface-border/40">
      {versions.map((v) => (
        <VersionEntry key={v.version} role={role} summary={v} onLoad={onLoad} />
      ))}
    </div>
  );
}

function VersionEntry({
  role,
  summary,
  onLoad,
}: {
  role: string;
  summary: RoleSchemaVersionSummary;
  onLoad: (schema: Record<string, unknown> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Snapshot fetch is lazy — only when the entry is expanded.
  const snapshot = useRoleSchema(role, summary.version, open);

  return (
    <div className="py-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left group">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text-secondary">v{summary.version}</span>
          {summary.is_current && (
            <span className="text-2xs font-bold uppercase tracking-wider text-accent">current</span>
          )}
          <span className="flex-1" />
          <span className="text-2xs text-text-quaternary shrink-0">
            {new Date(summary.created_at).toLocaleDateString()}
          </span>
        </div>
        {summary.change_summary && (
          <p className="mt-0.5 text-2xs text-text-tertiary truncate">{summary.change_summary}</p>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {snapshot.data ? (
            <>
              {snapshot.data.form_schema
                ? <JsonViewer data={snapshot.data.form_schema} defaultCollapsed />
                : <p className="text-2xs text-text-quaternary">This version carries no form schema.</p>}
              <button
                onClick={() => onLoad((snapshot.data!.form_schema ?? null) as Record<string, unknown> | null)}
                className="text-2xs text-accent hover:underline"
              >
                Load into editor
              </button>
            </>
          ) : (
            <p className="text-2xs text-text-quaternary">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
