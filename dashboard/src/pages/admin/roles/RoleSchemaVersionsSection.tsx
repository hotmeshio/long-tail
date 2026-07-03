import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  useRoleSchemaVersions,
  useRoleSchema,
  type RoleSchemaVersionSummary,
} from '../../../api/roles';
import { JsonViewer } from '../../../components/common/data/JsonViewer';

/**
 * Schema version history for a role. Every save that changes the form or
 * metadata schema appends an immutable snapshot; workflows pin one via
 * conditionLT's schemaVersion (metadata.schema_version) so the resolver form
 * an escalation renders stays exactly what its author specified, even after
 * the role's schema moves on. Escalations without a pin use the latest.
 */
export function RoleSchemaVersionsSection({ role }: { role: string }) {
  const { data } = useRoleSchemaVersions(role);
  const versions = data?.versions ?? [];

  if (versions.length === 0) {
    return (
      <p className="text-[11px] text-text-tertiary">
        Versions appear here after the first schema save. Workflows can pin one
        with <code className="font-mono">schemaVersion</code> so their resolver
        form keeps that exact shape.
      </p>
    );
  }

  return (
    <div className="divide-y divide-surface-border/40">
      {versions.map((v) => (
        <VersionRow key={v.version} role={role} summary={v} />
      ))}
    </div>
  );
}

function VersionRow({ role, summary }: { role: string; summary: RoleSchemaVersionSummary }) {
  const [open, setOpen] = useState(false);
  // Snapshot fetch is lazy — only when the row is expanded.
  const snapshot = useRoleSchema(role, summary.version, open);

  return (
    <div className="py-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 text-left group"
      >
        <ChevronRight
          className={`w-3 h-3 text-text-quaternary transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-xs font-mono text-text-secondary">v{summary.version}</span>
        {summary.is_current && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-accent">current</span>
        )}
        <span className="flex-1 truncate text-[10px] text-text-tertiary">
          {summary.change_summary ?? ''}
        </span>
        <span className="text-[10px] text-text-quaternary shrink-0">
          {new Date(summary.created_at).toLocaleDateString()}
        </span>
      </button>
      {open && (
        <div className="mt-2 ml-5 space-y-3">
          {snapshot.data ? (
            <>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-text-quaternary mb-1">Form Schema</p>
                {snapshot.data.form_schema
                  ? <JsonViewer data={snapshot.data.form_schema} defaultCollapsed />
                  : <p className="text-[10px] text-text-quaternary">—</p>}
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-text-quaternary mb-1">Metadata Schema</p>
                {snapshot.data.metadata_schema
                  ? <JsonViewer data={snapshot.data.metadata_schema} defaultCollapsed />
                  : <p className="text-[10px] text-text-quaternary">—</p>}
              </div>
            </>
          ) : (
            <p className="text-[10px] text-text-quaternary">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
