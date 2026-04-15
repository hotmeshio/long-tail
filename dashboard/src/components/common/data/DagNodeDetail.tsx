import type { ActivityManifestEntry } from '../../../api/types';

interface DagNodeDetailProps {
  entry: ActivityManifestEntry;
  onClose: () => void;
}

export function DagNodeDetail({ entry, onClose }: DagNodeDetailProps) {
  const hasMappings = entry.input_mappings && Object.keys(entry.input_mappings).length > 0;
  const hasOutputFields = entry.output_fields?.length > 0;

  return (
    <div className="space-y-4 text-xs">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-medium text-sm text-text-primary truncate">{entry.title}</p>
          <p className="font-mono text-[10px] text-text-tertiary mt-0.5 truncate">{entry.activity_id}</p>
        </div>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary text-[10px] shrink-0"
        >
          Close
        </button>
      </div>

      {/* Metadata — alignment and whitespace, no boxes */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <Field label="Type" value={entry.type} />
        <Field label="Source" value={entry.tool_source} />
        {entry.mcp_tool_name && <Field label="Tool" value={entry.mcp_tool_name} />}
        {entry.mcp_server_id && <Field label="Server" value={entry.mcp_server_id} />}
        {entry.model && <Field label="Model" value={entry.model} />}
        {entry.topic && <Field label="Topic" value={entry.topic} />}
        {entry.hook_topic && <Field label="Hook" value={entry.hook_topic} />}
      </div>

      {/* Input mappings */}
      {hasMappings && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
            Input Mappings
          </p>
          <div className="grid gap-1">
            {Object.entries(entry.input_mappings).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2">
                <span className="font-mono text-text-secondary shrink-0">{k}</span>
                <span className="text-text-tertiary shrink-0">&larr;</span>
                <span className="font-mono text-accent/70 truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output fields */}
      {hasOutputFields && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
            Output Fields
          </p>
          <p className="font-mono text-text-secondary leading-relaxed">
            {entry.output_fields.join(', ')}
          </p>
        </div>
      )}

      {/* Prompt template (LLM only) */}
      {entry.prompt_template && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
            Prompt Template
          </p>
          <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
            {entry.prompt_template}
          </pre>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
        {label}
      </p>
      <p className="font-mono text-text-primary">{value}</p>
    </div>
  );
}
