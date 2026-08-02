import { Link } from 'react-router-dom';
import { Braces, LayoutList, ShieldCheck } from 'lucide-react';
import { JsonViewer } from '../../../../components/common/data/JsonViewer';
import {
  SectionGroup,
  Toggle,
  safeParseJson,
  type SectionProps,
} from '../role-detail-shared';

/**
 * Schemas — the role's three contracts: the resolve form (versioned, edited on
 * its own page), the list view (versioned independently), and the metadata
 * validator (inline). Enforcement leads: it decides whether the form schema is
 * advisory or a server-side gate.
 */
export function SchemasSection({
  role,
  draft,
  update,
  errors,
  editingJson,
  startEditingJson,
  setMetadataSchemaError,
}: SectionProps & {
  editingJson: Set<string>;
  startEditingJson: (field: string) => void;
  setMetadataSchemaError: (msg?: string) => void;
}) {
  return (
    <div className="space-y-14">
      {/* Enforcement — whether the form schema is a server-side gate */}
      <SectionGroup icon={ShieldCheck} label="Enforcement" annotation="server-side resolver validation" accent>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-text-secondary">Enforce the escalation form schema</p>
            <p className="text-2xs text-text-tertiary leading-relaxed mt-1">
              Every resolve surface — API, MCP, CLI — validates submitted
              payloads against this role's form schema and rejects violations
              with field-level errors before any state changes.
            </p>
          </div>
          <Toggle
            checked={draft.enforce_schema}
            onChange={() => update({ enforce_schema: !draft.enforce_schema })}
            title="Validate every resolve payload against this role's form schema"
          />
        </div>
      </SectionGroup>

      {/* Escalation Schema — versioned, edited on its own page */}
      <SectionGroup
        icon={Braces}
        label="Escalation Schema"
        annotation="the resolve form"
        accent
        aside={
          role.current_schema_version != null ? (
            <span className="text-2xs font-mono text-text-quaternary">v{role.current_schema_version} in use</span>
          ) : undefined
        }
      >
        <p className="text-2xs text-text-tertiary mb-3 leading-relaxed">
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
      </SectionGroup>

      {/* Escalations List Schema — versioned independently, edited on its own page */}
      <SectionGroup
        icon={LayoutList}
        label="Escalations List Schema"
        annotation="rich list view"
        aside={
          role.current_list_schema_version != null ? (
            <span className="text-2xs font-mono text-text-quaternary">v{role.current_list_schema_version} in use</span>
          ) : undefined
        }
      >
        <p className="text-2xs text-text-tertiary mb-3 leading-relaxed">
          Richly formats the escalation list when it's scoped to just this role.
          Versioned on its own timeline — separate from the resolve form.
        </p>
        <Link
          to={`/admin/roles/${encodeURIComponent(role.role)}/list-schema`}
          className="text-xs text-accent hover:underline"
        >
          {role.list_schema
            ? `Open list schema editor — v${role.current_list_schema_version ?? 1} in use →`
            : 'Define the list view →'}
        </Link>
      </SectionGroup>

      {/* Metadata Schema — inline editor */}
      <SectionGroup
        icon={Braces}
        label="Metadata Schema"
        annotation="validates metadata at creation"
        aside={
          !editingJson.has('metadata_schema') && role.metadata_schema ? (
            <button onClick={() => startEditingJson('metadata_schema')} className="text-2xs text-accent hover:underline">Edit</button>
          ) : undefined
        }
      >
        <p className="text-2xs text-text-tertiary mb-3 leading-relaxed">
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
                setMetadataSchemaError(safeParseJson(val).ok ? undefined : 'Invalid JSON');
              }}
              rows={10}
              spellCheck={false}
              className="input text-xs font-mono w-full resize-y"
              placeholder={'{\n  "type": "object",\n  "properties": {\n    "order_id": { "type": "string" }\n  },\n  "required": ["order_id"]\n}'}
            />
            {errors.metadata_schema && <p className="text-2xs text-status-error mt-1">{errors.metadata_schema}</p>}
          </>
        )}
      </SectionGroup>

      {/* Properties (free custom-JSON bag) is intentionally not rendered:
          nothing consumes it yet. The draft still round-trips the stored
          value on save, so existing data is kept. */}
    </div>
  );
}
