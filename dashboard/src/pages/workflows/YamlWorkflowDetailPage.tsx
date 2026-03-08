import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
  useInvokeYamlWorkflow,
  useArchiveYamlWorkflow,
  useDeleteYamlWorkflow,
  useRegenerateYamlWorkflow,
} from '../../api/yaml-workflows';
import { StatusBadge } from '../../components/common/StatusBadge';
import { JsonViewer } from '../../components/common/JsonViewer';
import { PageHeader } from '../../components/common/PageHeader';
import { Field } from '../../components/common/Field';
import { useSettings } from '../../api/settings';
import type { ActivityManifestEntry } from '../../api/types/yaml-workflows';

const statusMap: Record<string, string> = {
  draft: 'pending',
  deployed: 'in_progress',
  active: 'completed',
  archived: 'failed',
};

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
  ngn: 'Engine ID', tpc: 'Topic', app: 'App ID', vrs: 'Version',
  jid: 'Job ID', gid: 'Job GUID', aid: 'Activity ID', ts: 'Time Series',
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

function InvokeResultView({ result, showMetadata, onToggleMetadata, traceUrl }: {
  result: Record<string, unknown>; showMetadata: boolean;
  onToggleMetadata: () => void; traceUrl?: string | null;
}) {
  const raw = (result as any)?.result ?? result;
  const hasEnvelope = raw?.metadata && raw?.data;
  const displayData = hasEnvelope ? raw.data : raw;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Result</span>
        {hasEnvelope && (
          <button type="button" onClick={onToggleMetadata} className="text-[10px] text-accent hover:underline">
            {showMetadata ? 'Hide metadata' : 'Show metadata'}
          </button>
        )}
      </div>
      {showMetadata && hasEnvelope && (
        <div className="bg-surface-raised border border-surface-border rounded-md p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Metadata</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
            {Object.entries(raw.metadata as Record<string, unknown>).map(([key, val]) => (
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
      )}
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

function PipelineStrip({ activities, selectedIdx, onSelect, highlightIdx }: {
  activities: ActivityManifestEntry[]; selectedIdx: number; onSelect: (i: number) => void;
  highlightIdx?: number;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {activities.map((a, idx) => {
        const isSelected = idx === selectedIdx && highlightIdx === undefined;
        const isRunning = highlightIdx !== undefined && idx === highlightIdx;
        return (
          <div key={a.activity_id} className="flex items-center shrink-0">
            {idx > 0 && (
              <svg className="w-4 h-4 text-text-tertiary shrink-0 mx-0.5" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <button
              type="button"
              onClick={() => onSelect(idx)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-300 ${
                isRunning
                  ? 'bg-accent text-text-inverse border-accent scale-105 shadow-md shadow-accent/20'
                  : isSelected
                    ? 'bg-accent text-text-inverse border-accent'
                    : `${sourceColor(a.tool_source)} hover:opacity-80`
              }`}
            >
              <span className="font-mono">{idx + 1}</span>
              <span className="ml-1.5">{a.title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StepDetail({ activity }: { activity: ActivityManifestEntry }) {
  return (
    <div className="p-4 bg-surface-sunken rounded-md space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-text-primary font-mono">{activity.title}</h4>
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${sourceColor(activity.tool_source)}`}>
          {sourceLabel(activity.tool_source)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        <div>
          <p className="text-[10px] text-text-tertiary">Topic</p>
          <p className="text-xs font-mono text-text-primary truncate">{activity.topic}</p>
        </div>
        {activity.tool_source !== 'llm' && activity.mcp_tool_name && (
          <div>
            <p className="text-[10px] text-text-tertiary">Tool</p>
            <p className="text-xs font-mono text-text-primary">
              {activity.tool_source === 'db' ? 'db' : activity.mcp_server_id}/{activity.mcp_tool_name}
            </p>
          </div>
        )}
        {activity.tool_source === 'llm' && (
          <div>
            <p className="text-[10px] text-text-tertiary">Model</p>
            <p className="text-xs font-mono text-text-primary">{activity.model || 'gpt-4o-mini'}</p>
          </div>
        )}
      </div>

      {Object.keys(activity.input_mappings).length > 0 && (
        <div>
          <p className="text-[10px] text-text-tertiary mb-1">Input Mappings</p>
          <div className="space-y-0.5">
            {Object.entries(activity.input_mappings).map(([k, v]) => (
              <p key={k} className="text-[10px] font-mono text-text-secondary">
                <span className="text-text-primary">{k}</span> ← <span className="text-accent">{v}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {activity.tool_source === 'llm' && activity.prompt_template && (
        <div>
          <p className="text-[10px] text-text-tertiary mb-1">Prompt Template</p>
          <pre className="p-2 bg-surface-raised border border-surface-border rounded text-[10px] font-mono text-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto">
            {activity.prompt_template}
          </pre>
        </div>
      )}

      {activity.output_fields.length > 0 && (
        <div>
          <p className="text-[10px] text-text-tertiary mb-1">Output Fields</p>
          <div className="flex flex-wrap gap-1">
            {activity.output_fields.map((f) => (
              <span key={f} className="text-[10px] font-mono px-1.5 py-0.5 bg-surface-raised border border-surface-border rounded text-text-secondary">{f}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Tab = 'pipeline' | 'config';

// ── Main Page ─────────────────────────────────────────────────

export function YamlWorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: wf, isLoading, refetch } = useYamlWorkflow(id!);
  const { data: settings } = useSettings();
  const deployMutation = useDeployYamlWorkflow();
  const activateMutation = useActivateYamlWorkflow();
  const invokeMutation = useInvokeYamlWorkflow();
  const archiveMutation = useArchiveYamlWorkflow();
  const deleteMutation = useDeleteYamlWorkflow();
  const regenerateMutation = useRegenerateYamlWorkflow();
  const [invokeFields, setInvokeFields] = useState<Record<string, any>>({});
  const [invokeJsonMode, setInvokeJsonMode] = useState(false);
  const [invokeJson, setInvokeJson] = useState('{}');
  const [invokeResult, setInvokeResult] = useState<Record<string, unknown> | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  const [selectedStep, setSelectedStep] = useState(0);
  const [cycleIdx, setCycleIdx] = useState<number | undefined>(undefined);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCycling = useCallback((count: number) => {
    setCycleIdx(0);
    let i = 0;
    cycleRef.current = setInterval(() => {
      i = (i + 1) % count;
      setCycleIdx(i);
    }, 600);
  }, []);

  const stopCycling = useCallback(() => {
    if (cycleRef.current) { clearInterval(cycleRef.current); cycleRef.current = null; }
    setCycleIdx(undefined);
  }, []);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => { if (cycleRef.current) clearInterval(cycleRef.current); };
  }, []);

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
    return <p className="text-sm text-text-secondary">Pipeline not found.</p>;
  }

  const workerActivities = wf.activity_manifest.filter((a) => a.type === 'worker');
  const inputProps = (wf.input_schema as any)?.properties || {};
  const inputKeys = Object.keys(inputProps);
  const error =
    deployMutation.error?.message || activateMutation.error?.message ||
    invokeMutation.error?.message || archiveMutation.error?.message ||
    deleteMutation.error?.message || regenerateMutation.error?.message;

  const handleDeploy = async () => { await deployMutation.mutateAsync(wf.id); refetch(); };
  const handleActivate = async () => { await activateMutation.mutateAsync(wf.id); refetch(); };
  const handleArchive = async () => {
    if (!confirm('Archive this pipeline? It will no longer accept invocations.')) return;
    await archiveMutation.mutateAsync(wf.id); refetch();
  };
  const handleDelete = async () => {
    if (!confirm('Delete this pipeline permanently?')) return;
    await deleteMutation.mutateAsync(wf.id);
  };
  const handleRegenerate = async () => {
    if (!confirm('Re-generate from the source execution? This will overwrite the current definition.')) return;
    await regenerateMutation.mutateAsync({ id: wf.id }); refetch();
  };
  const handleInvoke = async () => {
    setInvokeResult(null);
    startCycling(workerActivities.length);
    try {
      const data = invokeJsonMode ? JSON.parse(invokeJson) : invokeFields;
      const result = await invokeMutation.mutateAsync({ id: wf.id, data, sync: true });
      setInvokeResult(result);
    } catch (err: any) {
      setInvokeResult({ error: err.message });
    } finally {
      stopCycling();
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'config', label: 'Config' },
  ];

  return (
    <div>
      <PageHeader title="MCP Pipelines" backTo="/mcp/pipelines" backLabel="MCP Pipelines" />

      {/* ── Header ────────────────────────────────────────── */}
      <div className="px-6 py-5 mb-4">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-lg font-medium text-text-primary font-mono truncate flex-1">{wf.name}</h2>
          <StatusBadge status={statusMap[wf.status] ?? wf.status} />
        </div>

        {wf.description && <p className="text-xs text-text-secondary mb-4">{wf.description}</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-8 mb-4">
          <Field label="App ID" value={<span className="font-mono text-xs">{wf.app_id}</span>} />
          <Field label="Version" value={<span className="font-mono text-xs">{wf.app_version}</span>} />
          <Field label="Topic" value={<span className="font-mono text-xs">{wf.graph_topic}</span>} />
          <Field label="Steps" value={<span className="text-xs">{workerActivities.length}</span>} />
          {wf.source_workflow_id && (
            <Field label="Source" value={
              <Link to={`/workflows/detail/${wf.source_workflow_id}`} className="font-mono text-xs text-accent hover:underline">
                {wf.source_workflow_id}
              </Link>
            } />
          )}
          <Field label="Created" value={<span className="text-xs">{new Date(wf.created_at).toLocaleString()}</span>} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-surface-border">
          {wf.status === 'draft' && (
            <>
              <button onClick={handleDeploy} disabled={deployMutation.isPending} className="btn-primary text-xs">
                {deployMutation.isPending ? 'Deploying...' : 'Deploy'}
              </button>
              {wf.source_workflow_id && (
                <button onClick={handleRegenerate} disabled={regenerateMutation.isPending} className="btn-secondary text-xs">
                  {regenerateMutation.isPending ? 'Regenerating...' : 'Regenerate'}
                </button>
              )}
            </>
          )}
          {wf.status === 'deployed' && (
            <button onClick={handleActivate} disabled={activateMutation.isPending} className="btn-primary text-xs">
              {activateMutation.isPending ? 'Activating...' : 'Activate'}
            </button>
          )}
          {wf.status === 'active' && (
            <button onClick={handleArchive} disabled={archiveMutation.isPending} className="btn-secondary text-xs">Archive</button>
          )}
          {(wf.status === 'draft' || wf.status === 'archived') && (
            <button onClick={handleDelete} disabled={deleteMutation.isPending} className="text-xs text-status-error hover:underline">Delete</button>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
      </div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="flex gap-0 border-b border-surface-border mb-6 px-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-xs font-medium transition-colors relative ${
              activeTab === t.key
                ? 'text-accent'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {t.label}
            {activeTab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* ── Pipeline Tab (integrated with Run) ─────────── */}
      {activeTab === 'pipeline' && (
        <div className="px-6 space-y-4">
          {/* Pipeline strip with cycling animation */}
          <PipelineStrip
            activities={workerActivities}
            selectedIdx={selectedStep}
            onSelect={setSelectedStep}
            highlightIdx={cycleIdx}
          />

          {/* Step detail (collapses during run) */}
          {cycleIdx === undefined && workerActivities[selectedStep] && (
            <StepDetail activity={workerActivities[selectedStep]} />
          )}

          {/* Invoke form — inline below pipeline */}
          {wf.status === 'active' && (
            <form className="p-4 bg-surface-sunken rounded-md space-y-3" onSubmit={(e) => { e.preventDefault(); handleInvoke(); }}>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-text-primary">Input</h3>
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
                  className="w-full bg-surface-raised border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary h-32"
                  spellCheck={false} />
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
                            className="w-full bg-surface-raised border border-surface-border rounded-md px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary">
                            <option value="true">true</option><option value="false">false</option>
                          </select>
                        ) : fieldType === 'object' || fieldType === 'array' ? (
                          <textarea
                            value={typeof invokeFields[key] === 'string' ? invokeFields[key] : JSON.stringify(invokeFields[key] ?? (fieldType === 'array' ? [] : {}), null, 2)}
                            onChange={(e) => { try { updateField(key, JSON.parse(e.target.value), fieldType); } catch { setInvokeFields({ ...invokeFields, [key]: e.target.value }); } }}
                            className="w-full bg-surface-raised border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary h-20"
                            spellCheck={false} />
                        ) : (
                          <input type={fieldType === 'number' || fieldType === 'integer' ? 'number' : 'text'}
                            value={invokeFields[key] ?? ''} onChange={(e) => updateField(key, e.target.value, fieldType)}
                            className="w-full bg-surface-raised border border-surface-border rounded-md px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-text-tertiary">No input schema defined. Switch to JSON view to provide custom input.</p>
              )}

              <button type="submit" disabled={invokeMutation.isPending} className="btn-primary text-xs">
                {invokeMutation.isPending ? 'Running...' : 'Run Pipeline'}
              </button>
            </form>
          )}

          {/* Running indicator */}
          {invokeMutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              Executing pipeline...
            </div>
          )}

          {/* Result appears below after completion */}
          {invokeResult && (
            <InvokeResultView
              result={invokeResult}
              showMetadata={showMetadata}
              onToggleMetadata={() => setShowMetadata(!showMetadata)}
              traceUrl={settings?.telemetry?.traceUrl}
            />
          )}
        </div>
      )}

      {/* ── Config Tab ────────────────────────────────────── */}
      {activeTab === 'config' && (
        <div className="px-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <JsonViewer data={wf.input_schema} label="Input Schema" />
            <JsonViewer data={wf.output_schema} label="Output Schema" />
          </div>

          <div>
            <h3 className="text-sm font-medium text-text-primary mb-3">YAML Definition</h3>
            <pre className="p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre max-h-[600px] overflow-y-auto">
              {wf.yaml_content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
