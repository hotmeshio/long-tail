import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { TagInput } from '../../../components/common/form/TagInput';
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
} from '../../../api/yaml-workflows';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { Field } from '../../../components/common/data/Field';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { useSettings } from '../../../api/settings';
import { buildSkeleton } from './helpers';
import type { Section } from './helpers';
import { PipelineStrip, StepDetail } from './PipelineStrip';
import { LifecycleSidebar } from './LifecycleSidebar';
import { InvokeSection } from './InvokeSection';
import { ConfigurationSection } from './ConfigurationSection';
import { VersionHistory } from './VersionHistory';

// Status values (draft, deployed, active, archived) are passed directly
// to StatusBadge which handles styling and labels natively.

export function YamlWorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
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
  const [inputFieldMetaDraft, setInputFieldMetaDraft] = useState<import('../../../api/types').InputFieldMeta[]>([]);
  const [configEditing, setConfigEditing] = useState(false);
  const yamlTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (wf?.yaml_content) setYamlDraft(wf.yaml_content);
    if (wf?.input_schema) setInputSchemaDraft(JSON.stringify(wf.input_schema, null, 2));
    if (wf?.output_schema) setOutputSchemaDraft(JSON.stringify(wf.output_schema, null, 2));
    if (wf?.input_field_meta) setInputFieldMetaDraft(wf.input_field_meta);
  }, [wf?.id, wf?.yaml_content, wf?.input_schema, wf?.output_schema, wf?.input_field_meta]);

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

  const isActive = wf.status === 'active' || wf.status === 'deployed';
  const canEditConfig = wf.status !== 'archived' && !isViewingHistory;
  const showInvoke = isActive && !isViewingHistory;
  const toggleSection = (key: string) => setOpenSection(openSection === key ? null : key as Section);

  return (
    <div>
      <PageHeader
        title="Workflow Tool"
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
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
                <>
                  <Field label="Compiled From Workflow" value={
                    <Link to={`/workflows/executions/${wf.source_workflow_id}`} className="font-mono text-xs text-accent hover:underline">
                      {wf.source_workflow_id}
                    </Link>
                  } />
                  <Field label="" value={
                    <Link to={`/mcp/queries/${wf.source_workflow_id}`} className="text-xs text-accent hover:underline">
                      Open in Deterministic MCP Wizard
                    </Link>
                  } />
                </>
              )}
              <Field label="Invocations" value={
                <Link to={`/mcp/executions?entity=${encodeURIComponent(wf.graph_topic)}&namespace=${encodeURIComponent(wf.app_id)}`} className="text-xs text-accent hover:underline">
                  View runs
                </Link>
              } />
              <Field label="Created" value={<span className="text-xs">{new Date(wf.created_at).toLocaleString()}</span>} />
            </div>

            {/* Tags */}
            <div className="mt-4 pt-4 border-t border-surface-border">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Tags</p>
              {wf.status !== 'archived' ? (
                <TagInput
                  tags={wf.tags ?? []}
                  onChange={(next) => {
                    // Optimistically update the cache so the UI reflects instantly
                    queryClient.setQueryData(['yamlWorkflows', wf.id], { ...wf, tags: next });
                    updateMutation.mutate({ id: wf.id, tags: next });
                  }}
                  placeholder="Add tags for tool discovery..."
                />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(wf.tags ?? []).length > 0 ? (
                    (wf.tags ?? []).map((tag) => (
                      <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-medium">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-text-tertiary">No tags</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Collapsible sections ─────────────────────── */}
          <div className="space-y-6">

            {/* ── Invoke / Try ────────────────────────────── */}
            {showInvoke && (
              <InvokeSection
                wf={wf}
                inputSchema={resolvedInputSchema}
                invokeFields={invokeFields}
                setInvokeFields={setInvokeFields}
                invokeJson={invokeJson}
                setInvokeJson={setInvokeJson}
                invokeJsonMode={invokeJsonMode}
                setInvokeJsonMode={setInvokeJsonMode}
                invokeResult={invokeResult}
                setInvokeResult={setInvokeResult}
                showMetadata={showMetadata}
                setShowMetadata={setShowMetadata}
                invokeMutation={invokeMutation}
                inputFieldMeta={wf.input_field_meta}
                settings={settings}
                onInvoke={handleInvoke}
                isCollapsed={openSection !== 'invoke'}
                onToggle={toggleSection}
              />
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
            <ConfigurationSection
              wf={wf}
              resolvedInputSchema={resolvedInputSchema}
              resolvedOutputSchema={resolvedOutputSchema}
              resolvedYaml={resolvedYaml}
              configEditing={configEditing}
              setConfigEditing={setConfigEditing}
              canEditConfig={canEditConfig}
              yamlDraft={yamlDraft}
              setYamlDraft={setYamlDraft}
              inputSchemaDraft={inputSchemaDraft}
              setInputSchemaDraft={setInputSchemaDraft}
              outputSchemaDraft={outputSchemaDraft}
              setOutputSchemaDraft={setOutputSchemaDraft}
              inputFieldMetaDraft={inputFieldMetaDraft}
              setInputFieldMetaDraft={setInputFieldMetaDraft}
              onSave={handleSaveConfig}
              onCancel={handleCancelEdit}
              updateMutation={updateMutation}
              yamlTextareaRef={yamlTextareaRef}
              isCollapsed={openSection !== 'config'}
              onToggle={toggleSection}
            />

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
            <VersionHistory
              versionsData={versionsData}
              searchParams={searchParams}
              setSearchParams={setSearchParams}
              currentVersion={wf.content_version}
              viewingVersion={viewingVersion}
            />
          )}
        </div>
      </div>
    </div>
  );
}
