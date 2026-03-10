import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import {
  useYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
  useInvokeYamlWorkflow,
  useArchiveYamlWorkflow,
  useDeleteYamlWorkflow,
  useRegenerateYamlWorkflow,
  useUpdateYamlWorkflow,
  useYamlWorkflowVersions,
  useYamlWorkflowVersion,
} from '../../api/yaml-workflows';
import { StatusBadge } from '../../components/common/StatusBadge';
import { JsonViewer } from '../../components/common/JsonViewer';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { Field } from '../../components/common/Field';
import { Collapsible } from '../../components/common/Collapsible';
import { CollapsibleSection } from '../../components/common/CollapsibleSection';
import { useSettings } from '../../api/settings';
import type { ActivityManifestEntry } from '../../api/types/yaml-workflows';

// Status values (draft, deployed, active, archived) are passed directly
// to StatusBadge which handles styling and labels natively.

function buildSkeleton(schema: Record<string, any>): Record<string, any> {
  if (!schema?.properties) return {};
  const result: Record<string, any> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const p = prop as any;
    if (p.default !== undefined) result[key] = p.default;
    else if (p.type === 'string') result[key] = '';
    else if (p.type === 'number' || p.type === 'integer') result[key] = 0;
    else if (p.type === 'boolean') result[key] = false;
    else if (p.type === 'object') result[key] = {};
    else if (p.type === 'array') result[key] = [];
    else result[key] = null;
  }
  return result;
}

function inferFieldType(schemaProp: any): string {
  if (!schemaProp) return 'string';
  return schemaProp.type || 'string';
}

// ── Metadata helpers ──────────────────────────────────────────

const metadataLabels: Record<string, string> = {
  app: 'MCP Workflow Server', tpc: 'MCP Workflow Tool', vrs: 'Version', ngn: 'Engine ID',
  jid: 'Job ID', gid: 'Run ID', aid: 'Activity ID', ts: 'Time Series',
  jc: 'Created', ju: 'Updated', trc: 'Trace ID', js: 'Job Status',
};

const jobStatusLabels: Record<number, string> = { 0: 'Completed', 1: 'Pending', 2: 'Error' };

function parseCompactTimestamp(val: string): string {
  const match = val.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d+)$/);
  if (!match) return val;
  const [, y, mo, d, h, mi, s, ms] = match;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

function formatMetadataValue(key: string, value: unknown): string {
  if (key === 'js' && typeof value === 'number') return jobStatusLabels[value] ?? `Unknown (${value})`;
  if ((key === 'jc' || key === 'ju') && typeof value === 'string') return parseCompactTimestamp(value);
  return String(value ?? '');
}

// ── Sub-components ────────────────────────────────────────────

function InvokeResultView({ result, showMetadata, onToggleMetadata, traceUrl, namespace }: {
  result: Record<string, unknown>; showMetadata: boolean;
  onToggleMetadata: () => void; traceUrl?: string | null; namespace?: string;
}) {
  const raw = (result as any)?.result ?? result;
  const jobId = (result as any)?.job_id as string | undefined;
  const hasEnvelope = raw?.metadata && raw?.data;
  const displayData = hasEnvelope ? raw.data : raw;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Result</span>
        <div className="flex items-center gap-3">
          {jobId && (
            <Link
              to={`/mcp/runs/${encodeURIComponent(jobId)}?namespace=${encodeURIComponent(namespace || 'longtail')}`}
              className="text-[10px] text-accent hover:underline"
            >
              View Execution Details
            </Link>
          )}
          {hasEnvelope && (
            <button type="button" onClick={onToggleMetadata} className="text-[10px] text-accent hover:underline">
              {showMetadata ? 'Hide metadata' : 'Show metadata'}
            </button>
          )}
        </div>
      </div>
      <Collapsible open={showMetadata && !!hasEnvelope}>
        <div className="bg-surface-raised border border-surface-border rounded-md p-3 mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Metadata</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {hasEnvelope && Object.entries(raw.metadata as Record<string, unknown>)
              .sort((a, b) => {
                const order = Object.keys(metadataLabels);
                return (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]));
              })
              .map(([key, val]) => (
              <div key={key}>
                <p className="text-[10px] text-text-tertiary">{metadataLabels[key] ?? key}</p>
                {key === 'trc' && traceUrl && val ? (
                  <a href={traceUrl.replace('{traceId}', String(val))} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-mono text-accent hover:underline truncate block" title={String(val)}>
                    {String(val)}
                  </a>
                ) : (
                  <p className="text-xs font-mono text-text-primary truncate" title={String(val ?? '')}>
                    {formatMetadataValue(key, val)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </Collapsible>
      <JsonViewer data={displayData} label="Data" />
    </div>
  );
}

function sourceLabel(s: ActivityManifestEntry['tool_source']) {
  if (s === 'llm') return 'LLM';
  if (s === 'db') return 'DB';
  return 'MCP';
}

function sourceColor(s: ActivityManifestEntry['tool_source']) {
  if (s === 'llm') return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  return 'bg-accent-primary/10 text-accent border-accent-primary/20';
}

function PipelineStrip({ activities, selectedIdx, onSelect }: {
  activities: ActivityManifestEntry[]; selectedIdx: number; onSelect: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {activities.map((a, idx) => {
        const isSelected = idx === selectedIdx;
        return (
          <div key={a.activity_id} className="flex items-center shrink-0">
            {idx > 0 && (
              <div className="w-4 h-px bg-surface-border mx-0.5" />
            )}
            <button
              type="button"
              onClick={() => onSelect(idx)}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              <span
                className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-sunken text-text-tertiary hover:bg-accent-muted hover:text-accent'
                }`}
              >
                {idx + 1}
              </span>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
                  isSelected ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary'
                }`}
              >
                {a.title}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StepDetail({ activity }: { activity: ActivityManifestEntry }) {
  const hasInputs = Object.keys(activity.input_mappings).length > 0;
  const hasOutputs = activity.output_fields.length > 0;
  const isLlm = activity.tool_source === 'llm';

  const serverId = activity.mcp_server_id || (activity.tool_source === 'db' ? 'db' : '');
  const toolDisplay = !isLlm && activity.mcp_tool_name
    ? `${serverId}/${activity.mcp_tool_name}`
    : null;
  const toolIsLinkable = !isLlm && activity.mcp_tool_name && serverId;

  return (
    <div className="pt-2 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h4 className="text-base font-medium text-text-primary">{activity.title}</h4>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${sourceColor(activity.tool_source)}`}>
          {sourceLabel(activity.tool_source)}
        </span>
      </div>

      {/* Identity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Mapped Workflow Topic</p>
          <p className="text-sm font-mono text-text-primary">{activity.topic}</p>
        </div>
        {toolDisplay && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tool</p>
            {toolIsLinkable ? (
              <Link
                to={`/mcp/servers?search=${encodeURIComponent(activity.mcp_tool_name!)}`}
                className="text-sm font-mono text-accent hover:underline"
              >
                {toolDisplay}
              </Link>
            ) : (
              <p className="text-sm font-mono text-text-primary">{toolDisplay}</p>
            )}
          </div>
        )}
        {isLlm && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Model</p>
            <p className="text-sm font-mono text-text-primary">{activity.model || 'gpt-4o-mini'}</p>
          </div>
        )}
      </div>

      {/* Input → Output */}
      {(hasInputs || hasOutputs) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
          {hasInputs && (
            <div className="border border-surface-border rounded-md p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Inputs</p>
              <div className="space-y-1.5">
                {Object.entries(activity.input_mappings).map(([k, v]) => (
                  <p key={k} className="text-xs font-mono text-text-secondary leading-relaxed">
                    <span className="text-text-primary">{k}</span>
                    <span className="text-text-tertiary mx-1.5">&larr;</span>
                    <span className="text-accent">{v}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {hasOutputs && (
            <div className="border border-surface-border rounded-md p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Outputs</p>
              <div className="space-y-1.5">
                {activity.output_fields.map((f) => (
                  <p key={f} className="text-xs font-mono text-text-secondary leading-relaxed">{f}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* LLM Prompt — special treatment */}
      {isLlm && activity.prompt_template && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Prompt Template</p>
          <pre className="p-4 bg-surface-sunken rounded-lg text-xs font-mono text-text-secondary whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
            {activity.prompt_template}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Lifecycle sidebar ─────────────────────────────────────────

const LIFECYCLE_STEPS = ['draft', 'active', 'archived'] as const;
const LIFECYCLE_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const LIFECYCLE_COLORS: Record<string, { filled: string; faded: string; line: string }> = {
  draft:    { filled: 'bg-status-pending border-status-pending', faded: 'bg-status-pending/30 border-status-pending/50', line: 'bg-status-pending/30' },
  active:   { filled: 'bg-status-success border-status-success', faded: 'bg-status-success/30 border-status-success/50', line: 'bg-status-success/30' },
  archived: { filled: 'bg-text-tertiary border-text-tertiary',   faded: 'bg-text-tertiary/30 border-text-tertiary/50',   line: 'bg-text-tertiary/30' },
};

function LifecycleSidebar({
  status,
  sourceWorkflowId,
  contentVersion,
  deployedContentVersion,
  onDeploy,
  onArchive,
  onDelete,
  onRegenerate,
  isPending,
  error,
}: {
  status: string;
  sourceWorkflowId?: string | null;
  contentVersion?: number;
  deployedContentVersion?: number | null;
  onDeploy: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  isPending: boolean;
  error?: string;
}) {
  // Treat 'deployed' as 'active' since deploy now auto-activates
  const effectiveStatus = status === 'deployed' ? 'active' : status;
  const currentIdx = LIFECYCLE_STEPS.indexOf(effectiveStatus as any);
  const needsRedeploy = contentVersion != null && contentVersion > (deployedContentVersion ?? 0);

  return (
    <div>
      <SectionLabel className="mb-4">Lifecycle</SectionLabel>

      {/* Out-of-sync warning */}
      {needsRedeploy && effectiveStatus !== 'draft' && effectiveStatus !== 'archived' && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-pending/10 border border-status-pending/30">
          <p className="text-[10px] font-semibold text-status-pending mb-1">YAML modified</p>
          <p className="text-[10px] text-text-secondary leading-relaxed">
            v{contentVersion} edited since deploy (v{deployedContentVersion}). Redeploy to apply changes.
          </p>
          <button onClick={onDeploy} disabled={isPending} className="mt-1.5 text-[10px] font-medium text-status-pending hover:underline">
            {isPending ? 'Deploying...' : 'Deploy now'}
          </button>
        </div>
      )}

      {/* Step sequence */}
      <div className="space-y-0">
        {LIFECYCLE_STEPS.map((step, idx) => {
          const isCurrent = step === effectiveStatus;
          const isDone = idx < currentIdx;
          const isFuture = idx > currentIdx;
          const isLast = idx === LIFECYCLE_STEPS.length - 1;
          const colors = LIFECYCLE_COLORS[step];

          return (
            <div key={step} className="flex items-stretch gap-3">
              {/* Vertical track */}
              <div className="flex flex-col items-center w-5 shrink-0">
                <span
                  className={`w-3 h-3 rounded-full shrink-0 border-2 transition-colors ${
                    isCurrent
                      ? colors.filled
                      : isDone
                        ? colors.faded
                        : 'bg-surface-sunken border-surface-border'
                  }`}
                />
                {!isLast && (
                  <span className={`w-px flex-1 ${isDone ? colors.line : 'bg-surface-border'}`} />
                )}
              </div>

              {/* Label + action */}
              <div className={`pb-5 ${isLast ? 'pb-0' : ''}`}>
                <p className={`text-xs font-medium ${isCurrent ? 'text-text-primary' : isFuture ? 'text-text-tertiary' : 'text-text-secondary'}`}>
                  {LIFECYCLE_LABELS[step]}
                </p>
                {/* Show the next-step action */}
                {isCurrent && step === 'draft' && (
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={onDeploy} disabled={isPending} className="btn-primary text-[11px] px-3 py-1">
                      {isPending ? 'Deploying...' : 'Deploy'}
                    </button>
                    {sourceWorkflowId && (
                      <button onClick={onRegenerate} disabled={isPending} className="text-[10px] text-text-tertiary hover:text-text-primary">
                        Regenerate
                      </button>
                    )}
                  </div>
                )}
                {isCurrent && step === 'active' && (
                  <div className="mt-2">
                    <button onClick={onArchive} disabled={isPending} className="text-[11px] text-text-tertiary hover:text-status-error">
                      Archive
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Version info */}
      {contentVersion != null && (
        <div className="mt-4 pt-4 border-t border-surface-border">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Content Version</p>
          <p className="text-xs font-mono text-text-primary">
            v{contentVersion}
            {deployedContentVersion != null && (
              <span className="text-text-tertiary ml-1.5">(deployed: v{deployedContentVersion})</span>
            )}
          </p>
        </div>
      )}

      {/* Delete — only for draft/archived */}
      {(status === 'draft' || status === 'archived') && (
        <div className="mt-4 pt-4 border-t border-surface-border">
          <button onClick={onDelete} disabled={isPending} className="text-[11px] text-status-error hover:underline">
            Delete workflow tool
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-[11px] text-status-error">{error}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

type Section = 'invoke' | 'tools' | 'config';

export function YamlWorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: wf, isLoading, refetch } = useYamlWorkflow(id!);
  const { data: settings } = useSettings();
  const deployMutation = useDeployYamlWorkflow();
  const activateMutation = useActivateYamlWorkflow();
  const invokeMutation = useInvokeYamlWorkflow();
  const archiveMutation = useArchiveYamlWorkflow();
  const deleteMutation = useDeleteYamlWorkflow();
  const regenerateMutation = useRegenerateYamlWorkflow();
  const updateMutation = useUpdateYamlWorkflow();
  const [invokeFields, setInvokeFields] = useState<Record<string, any>>({});
  const [invokeJsonMode, setInvokeJsonMode] = useState(false);
  const [invokeJson, setInvokeJson] = useState('{}');
  const [invokeResult, setInvokeResult] = useState<Record<string, unknown> | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [openSection, setOpenSection] = useState<Section | null>('tools');
  const [selectedStep, setSelectedStep] = useState(0);

  // ── Version browsing ──────────────────────────────────────────
  const versionParam = searchParams.get('version');
  const viewingVersion = versionParam ? parseInt(versionParam, 10) : null;
  const isViewingHistory = viewingVersion !== null && wf && viewingVersion !== wf.content_version;
  const { data: versionsData } = useYamlWorkflowVersions(id!);
  const { data: versionSnapshot } = useYamlWorkflowVersion(id!, isViewingHistory ? viewingVersion : null);

  // Resolved data: use version snapshot if viewing history, otherwise current
  const resolvedManifest = isViewingHistory && versionSnapshot ? versionSnapshot.activity_manifest : wf?.activity_manifest;
  const resolvedInputSchema = isViewingHistory && versionSnapshot ? versionSnapshot.input_schema : wf?.input_schema;
  const resolvedOutputSchema = isViewingHistory && versionSnapshot ? versionSnapshot.output_schema : wf?.output_schema;
  const resolvedYaml = isViewingHistory && versionSnapshot ? versionSnapshot.yaml_content : wf?.yaml_content;

  // ── Configuration editing state ─────────────────────────────
  const [yamlDraft, setYamlDraft] = useState('');
  const [inputSchemaDraft, setInputSchemaDraft] = useState('');
  const [outputSchemaDraft, setOutputSchemaDraft] = useState('');
  const [configEditing, setConfigEditing] = useState(false);
  const yamlTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (wf?.yaml_content) setYamlDraft(wf.yaml_content);
    if (wf?.input_schema) setInputSchemaDraft(JSON.stringify(wf.input_schema, null, 2));
    if (wf?.output_schema) setOutputSchemaDraft(JSON.stringify(wf.output_schema, null, 2));
  }, [wf?.id, wf?.yaml_content, wf?.input_schema, wf?.output_schema]);

  useEffect(() => {
    if (wf?.input_schema) {
      const skeleton = buildSkeleton(wf.input_schema);
      setInvokeFields(skeleton);
      setInvokeJson(JSON.stringify(skeleton, null, 2));
    }
  }, [wf?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!wf) {
    return <p className="text-sm text-text-secondary">Workflow server not found.</p>;
  }

  const workerActivities = (resolvedManifest ?? wf.activity_manifest).filter((a) => a.type === 'worker');
  const inputProps = (resolvedInputSchema as any)?.properties || {};
  const inputKeys = Object.keys(inputProps);
  const lifecycleError =
    deployMutation.error?.message || activateMutation.error?.message ||
    archiveMutation.error?.message || deleteMutation.error?.message ||
    regenerateMutation.error?.message;
  const lifecyclePending =
    deployMutation.isPending || activateMutation.isPending ||
    archiveMutation.isPending || deleteMutation.isPending ||
    regenerateMutation.isPending;

  const handleDeploy = async () => { await deployMutation.mutateAsync(wf.id); refetch(); };

  const handleArchive = async () => {
    if (!confirm('Archive this workflow server? It will no longer accept invocations.')) return;
    await archiveMutation.mutateAsync(wf.id); refetch();
  };
  const handleDelete = async () => {
    if (!confirm('Delete this workflow server permanently?')) return;
    await deleteMutation.mutateAsync(wf.id);
  };
  const handleRegenerate = async () => {
    if (!confirm('Re-generate from the source execution? This will overwrite the current definition.')) return;
    await regenerateMutation.mutateAsync({ id: wf.id }); refetch();
  };
  const handleSaveConfig = async () => {
    let inputSchema: Record<string, unknown> | undefined;
    let outputSchema: Record<string, unknown> | undefined;
    try { inputSchema = JSON.parse(inputSchemaDraft); } catch { /* keep current */ }
    try { outputSchema = JSON.parse(outputSchemaDraft); } catch { /* keep current */ }
    await updateMutation.mutateAsync({
      id: wf.id,
      yaml_content: yamlDraft,
      ...(inputSchema ? { input_schema: inputSchema } : {}),
      ...(outputSchema ? { output_schema: outputSchema } : {}),
    });
    setConfigEditing(false);
    refetch();
  };
  const handleCancelEdit = () => {
    setYamlDraft(wf.yaml_content);
    setInputSchemaDraft(JSON.stringify(wf.input_schema, null, 2));
    setOutputSchemaDraft(JSON.stringify(wf.output_schema, null, 2));
    setConfigEditing(false);
  };
  const handleInvoke = async () => {
    setInvokeResult(null);
    try {
      const data = invokeJsonMode ? JSON.parse(invokeJson) : invokeFields;
      const result = await invokeMutation.mutateAsync({ id: wf.id, data, sync: true });
      setInvokeResult(result);
    } catch (err: any) {
      setInvokeResult({ error: err.message });
    }
  };
  const updateField = (key: string, value: any, type: string) => {
    let parsed = value;
    if (type === 'number' || type === 'integer') parsed = value === '' ? 0 : Number(value);
    else if (type === 'boolean') parsed = value === 'true' || value === true;
    const updated = { ...invokeFields, [key]: parsed };
    setInvokeFields(updated);
    setInvokeJson(JSON.stringify(updated, null, 2));
  };

  const isActive = wf.status === 'active' || wf.status === 'deployed';
  const canEditConfig = wf.status !== 'archived' && !isViewingHistory;
  const showInvoke = isActive && !isViewingHistory;
  const toggleSection = (key: string) => setOpenSection(openSection === key ? null : key as Section);

  return (
    <div>
      <PageHeader
        title="Workflow Tool"
        backTo="/mcp/workflows"
        backLabel="Workflow Tools"
        actions={
          wf.status === 'draft' && !isViewingHistory ? (
            <button
              onClick={handleDeploy}
              disabled={lifecyclePending}
              className="group flex items-center gap-2 text-left"
            >
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 text-accent shrink-0">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </span>
              <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-accent/10 text-accent font-medium group-hover:bg-accent/20 transition-colors mr-1">Deploy</span>
                {' '}to register <span className="font-mono font-medium text-text-primary">{wf.app_id}/{wf.graph_topic}</span> as an MCP Workflow Tool.
              </span>
            </button>
          ) : undefined
        }
      />

      {/* History banner */}
      {isViewingHistory && (
        <div className="mb-6 px-4 py-3 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-between">
          <p className="text-xs text-text-primary">
            Viewing version <span className="font-mono font-medium">{viewingVersion}</span>
            {versionSnapshot?.change_summary && (
              <span className="text-text-tertiary ml-2">— {versionSnapshot.change_summary}</span>
            )}
            <span className="ml-2 text-text-tertiary">(read-only)</span>
          </p>
          <button
            onClick={() => { const next = new URLSearchParams(searchParams); next.delete('version'); setSearchParams(next); }}
            className="text-xs text-accent hover:underline"
          >
            Back to current
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-12">
        {/* ── Left: main content ─────────────────────────── */}
        <div>
          {/* Header card */}
          <div className="bg-surface-raised border border-surface-border rounded-md p-5 mb-8">
            <div className="flex items-center gap-4 mb-4">
              <h2 className="text-lg font-medium text-text-primary font-mono truncate flex-1">{wf.name}</h2>
              <StatusBadge status={wf.status} />
              {isActive && !isViewingHistory && (
                <button
                  type="button"
                  onClick={() => setOpenSection('invoke')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-medium hover:bg-purple-500/20 transition-colors"
                >
                  <Play className="w-3 h-3" />
                  Invoke
                </button>
              )}
            </div>

            {wf.description && <p className="text-xs text-text-secondary mb-4">{wf.description}</p>}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-8">
              <Field label="MCP Workflow Server" value={<span className="font-mono text-xs">{wf.app_id}</span>} />
              <Field label="MCP Workflow Tool" value={<span className="font-mono text-xs">{wf.graph_topic}</span>} />
              <Field label="Version" value={
                <span className="font-mono text-xs">
                  {wf.app_version}
                  {versionsData && versionsData.total > 1 && (
                    <span className="text-text-tertiary ml-1">(v{wf.content_version})</span>
                  )}
                </span>
              } />
              <Field label="Tool Calls" value={<span className="text-xs">{workerActivities.length}</span>} />
              {wf.source_workflow_id && (
                <Field label="Compiled From Workflow" value={
                  <Link to={`/workflows/detail/${wf.source_workflow_id}`} className="font-mono text-xs text-accent hover:underline">
                    {wf.source_workflow_id}
                  </Link>
                } />
              )}
              <Field label="Invocations" value={
                <Link to={`/mcp/runs?entity=${encodeURIComponent(wf.graph_topic)}&namespace=${encodeURIComponent(wf.app_id)}`} className="text-xs text-accent hover:underline">
                  View runs
                </Link>
              } />
              <Field label="Created" value={<span className="text-xs">{new Date(wf.created_at).toLocaleString()}</span>} />
            </div>
          </div>

          {/* ── Collapsible sections ─────────────────────── */}
          <div className="space-y-6">

            {/* ── Invoke / Try ────────────────────────────── */}
            {showInvoke && (
              <CollapsibleSection sectionKey="invoke" title="Invoke / Try" isCollapsed={openSection !== 'invoke'} onToggle={toggleSection} >
                <div className="space-y-4">
                  {/* Input form */}
                  {!invokeResult && (
                    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleInvoke(); }}>
                      <div className="flex items-center justify-between">
                        <SectionLabel>Input</SectionLabel>
                        <button type="button" onClick={() => {
                          if (!invokeJsonMode) setInvokeJson(JSON.stringify(invokeFields, null, 2));
                          else { try { setInvokeFields(JSON.parse(invokeJson)); } catch { /* keep */ } }
                          setInvokeJsonMode(!invokeJsonMode);
                        }} className="text-[10px] text-accent hover:underline">
                          {invokeJsonMode ? 'Form view' : 'JSON view'}
                        </button>
                      </div>

                      {invokeJsonMode ? (
                        <textarea value={invokeJson} onChange={(e) => setInvokeJson(e.target.value)}
                          className="input font-mono text-[11px] w-full leading-relaxed"
                          rows={8} spellCheck={false} />
                      ) : inputKeys.length > 0 ? (
                        <div className="space-y-3">
                          {inputKeys.map((key) => {
                            const fieldType = inferFieldType(inputProps[key]);
                            return (
                              <div key={key}>
                                <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                                  {key}<span className="ml-2 font-normal normal-case">{fieldType}</span>
                                </label>
                                {fieldType === 'boolean' ? (
                                  <select value={String(invokeFields[key] ?? false)} onChange={(e) => updateField(key, e.target.value, fieldType)}
                                    className="select text-xs w-full">
                                    <option value="true">true</option><option value="false">false</option>
                                  </select>
                                ) : fieldType === 'object' || fieldType === 'array' ? (
                                  <textarea
                                    value={typeof invokeFields[key] === 'string' ? invokeFields[key] : JSON.stringify(invokeFields[key] ?? (fieldType === 'array' ? [] : {}), null, 2)}
                                    onChange={(e) => { try { updateField(key, JSON.parse(e.target.value), fieldType); } catch { setInvokeFields({ ...invokeFields, [key]: e.target.value }); } }}
                                    className="input font-mono text-[11px] w-full leading-relaxed"
                                    rows={4} spellCheck={false} />
                                ) : (
                                  <input type={fieldType === 'number' || fieldType === 'integer' ? 'number' : 'text'}
                                    value={invokeFields[key] ?? ''} onChange={(e) => updateField(key, e.target.value, fieldType)}
                                    className="input text-xs w-full" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-text-tertiary">No input schema defined. Switch to JSON view to provide custom input.</p>
                      )}

                      {invokeMutation.error && !invokeResult && (
                        <p className="text-xs text-status-error">{invokeMutation.error.message}</p>
                      )}

                      <button type="submit" disabled={invokeMutation.isPending} className="btn-primary text-xs">
                        {invokeMutation.isPending ? (
                          <span className="flex items-center gap-2">
                            <span className="inline-block w-3 h-3 border-2 border-text-inverse border-t-transparent rounded-full animate-spin" />
                            Running...
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <Play className="w-3 h-3" fill="currentColor" />
                            Invoke
                          </span>
                        )}
                      </button>
                    </form>
                  )}

                  {/* Result */}
                  {invokeResult && (
                    <div className="space-y-4">
                      <InvokeResultView
                        result={invokeResult}
                        showMetadata={showMetadata}
                        onToggleMetadata={() => setShowMetadata(!showMetadata)}
                        traceUrl={settings?.telemetry?.traceUrl}
                        namespace={wf.app_id}
                      />
                      <button
                        onClick={() => { setInvokeResult(null); invokeMutation.reset(); }}
                        className="text-xs text-accent hover:underline"
                      >
                        Run again
                      </button>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* ── Tools ──────────────────────────────────── */}
            <CollapsibleSection sectionKey="tools" title="Tools" isCollapsed={openSection !== 'tools'} onToggle={toggleSection} >
              <div className="space-y-4">
                <PipelineStrip
                  activities={workerActivities}
                  selectedIdx={selectedStep}
                  onSelect={setSelectedStep}
                />

                {workerActivities[selectedStep] && (
                  <StepDetail activity={workerActivities[selectedStep]} />
                )}
              </div>
            </CollapsibleSection>

            {/* ── Config ─────────────────────────────────── */}
            <CollapsibleSection sectionKey="config" title="Configuration" isCollapsed={openSection !== 'config'} onToggle={toggleSection} >
              <div className="space-y-6">
                {/* Edit / Save / Cancel controls */}
                <div className="flex items-center justify-between">
                  <a
                    href="https://github.com/hotmeshio/sdk-typescript/blob/main/docs/quickstart.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-accent hover:underline flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    YAML Guide
                  </a>
                  <div className="flex items-center gap-3">
                    {canEditConfig && !configEditing && (
                      <button
                        onClick={() => { setConfigEditing(true); setTimeout(() => yamlTextareaRef.current?.focus(), 50); }}
                        className="text-[10px] text-accent hover:underline"
                      >
                        Edit
                      </button>
                    )}
                    {configEditing && (
                      <>
                        <button onClick={handleCancelEdit} className="text-[10px] text-text-tertiary hover:text-text-primary">
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveConfig}
                          disabled={updateMutation.isPending || (
                            yamlDraft === wf.yaml_content
                            && inputSchemaDraft === JSON.stringify(wf.input_schema, null, 2)
                            && outputSchemaDraft === JSON.stringify(wf.output_schema, null, 2)
                          )}
                          className="text-[10px] text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          {updateMutation.isPending ? 'Saving...' : 'Save'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {updateMutation.error && (
                  <p className="text-xs text-status-error">{updateMutation.error.message}</p>
                )}

                {/* Schemas */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {configEditing ? (
                    <>
                      <div>
                        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input Schema</h4>
                        <textarea
                          value={inputSchemaDraft}
                          onChange={(e) => setInputSchemaDraft(e.target.value)}
                          className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                          rows={Math.max(inputSchemaDraft.split('\n').length + 1, 6)}
                          style={{ fieldSizing: 'content' } as React.CSSProperties}
                          spellCheck={false}
                        />
                      </div>
                      <div>
                        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output Schema</h4>
                        <textarea
                          value={outputSchemaDraft}
                          onChange={(e) => setOutputSchemaDraft(e.target.value)}
                          className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                          rows={Math.max(outputSchemaDraft.split('\n').length + 1, 6)}
                          style={{ fieldSizing: 'content' } as React.CSSProperties}
                          spellCheck={false}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <JsonViewer data={resolvedInputSchema ?? {}} label="Input Schema" />
                      <JsonViewer data={resolvedOutputSchema ?? {}} label="Output Schema" />
                    </>
                  )}
                </div>

                {/* YAML Definition */}
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">YAML Definition</h4>
                  {configEditing ? (
                    <textarea
                      ref={yamlTextareaRef}
                      value={yamlDraft}
                      onChange={(e) => setYamlDraft(e.target.value)}
                      className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                      rows={yamlDraft.split('\n').length + 1}
                      style={{ fieldSizing: 'content' } as React.CSSProperties}
                      spellCheck={false}
                    />
                  ) : (
                    <pre className="p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
                      {resolvedYaml ?? wf.yaml_content}
                    </pre>
                  )}
                </div>
              </div>
            </CollapsibleSection>

          </div>
        </div>

        {/* ── Right sidebar: lifecycle ────────────────────── */}
        <div className="lg:border-l lg:border-surface-border lg:pl-8 space-y-8">
          <LifecycleSidebar
            status={wf.status}
            sourceWorkflowId={wf.source_workflow_id}
            contentVersion={wf.content_version}
            deployedContentVersion={wf.deployed_content_version}
            onDeploy={handleDeploy}

            onArchive={handleArchive}
            onDelete={handleDelete}
            onRegenerate={handleRegenerate}
            isPending={lifecyclePending}
            error={lifecycleError}
          />

          {/* Version history */}
          {versionsData && versionsData.versions.length > 1 && (
            <div>
              <SectionLabel className="mb-3">Version History</SectionLabel>
              <div className="space-y-1">
                {versionsData.versions.map((v) => {
                  const isCurrent = v.version === wf.content_version;
                  const isViewing = viewingVersion === v.version;
                  return (
                    <button
                      key={v.version}
                      type="button"
                      onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        if (isCurrent) next.delete('version');
                        else next.set('version', String(v.version));
                        setSearchParams(next);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                        isViewing
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
                      }`}
                    >
                      <span className="font-mono font-medium">v{v.version}</span>
                      {isCurrent && <span className="text-text-tertiary ml-1">(current)</span>}
                      {v.change_summary && (
                        <p className="text-[10px] text-text-tertiary truncate mt-0.5">{v.change_summary}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
