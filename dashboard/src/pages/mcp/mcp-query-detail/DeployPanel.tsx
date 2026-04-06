import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MessageSquarePlus, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { ConfigurationSection } from '../../workflows/yaml-workflow-detail/ConfigurationSection';
import { LifecycleSidebar } from '../../workflows/yaml-workflow-detail/LifecycleSidebar';
import { VersionHistory } from '../../workflows/yaml-workflow-detail/VersionHistory';
import {
  useYamlWorkflow,
  useYamlWorkflowVersions,
  useYamlWorkflowVersion,
  useUpdateYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
  useArchiveYamlWorkflow,
  useRegenerateYamlWorkflow,
  useDeleteYamlWorkflow,
} from '../../../api/yaml-workflows';
import type { InputFieldMeta } from '../../../api/types';

interface DeployPanelProps {
  yamlId: string;
  onAdvance: () => void;
  onBack: () => void;
}

export function DeployPanel({ yamlId, onAdvance, onBack }: DeployPanelProps) {
  const queryClient = useQueryClient();
  const yamlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const { data: wf, refetch } = useYamlWorkflow(yamlId);
  const { data: versionsData } = useYamlWorkflowVersions(yamlId);

  const deployMutation = useDeployYamlWorkflow();
  const activateMutation = useActivateYamlWorkflow();
  const archiveMutation = useArchiveYamlWorkflow();
  const deleteMutation = useDeleteYamlWorkflow();
  const regenerateMutation = useRegenerateYamlWorkflow();
  const updateMutation = useUpdateYamlWorkflow();

  // Config editing state
  const [yamlDraft, setYamlDraft] = useState('');
  const [inputSchemaDraft, setInputSchemaDraft] = useState('');
  const [outputSchemaDraft, setOutputSchemaDraft] = useState('');
  const [inputFieldMetaDraft, setInputFieldMetaDraft] = useState<InputFieldMeta[]>([]);
  const [configEditing, setConfigEditing] = useState(false);

  // Version browsing
  const [versionParam, setVersionParam] = useState<number | null>(null);
  const isViewingHistory = versionParam !== null && wf != null && versionParam !== wf.content_version;
  const { data: versionSnapshot } = useYamlWorkflowVersion(yamlId, isViewingHistory ? versionParam : null);

  const resolvedYaml = isViewingHistory && versionSnapshot ? versionSnapshot.yaml_content : wf?.yaml_content;
  const resolvedInputSchema = isViewingHistory && versionSnapshot ? versionSnapshot.input_schema : wf?.input_schema;
  const resolvedOutputSchema = isViewingHistory && versionSnapshot ? versionSnapshot.output_schema : wf?.output_schema;

  // Sync drafts when workflow loads
  useEffect(() => {
    if (wf) {
      setYamlDraft(wf.yaml_content);
      setInputSchemaDraft(JSON.stringify(wf.input_schema, null, 2));
      setOutputSchemaDraft(JSON.stringify(wf.output_schema, null, 2));
      if (wf.input_field_meta) setInputFieldMetaDraft(wf.input_field_meta);
    }
  }, [wf?.id, wf?.content_version]);

  // Version history adapter (VersionHistory expects URLSearchParams)
  const versionSearchParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (versionParam !== null) sp.set('version', String(versionParam));
    return sp;
  }, [versionParam]);
  const setVersionSearchParams = useCallback((sp: URLSearchParams) => {
    const v = sp.get('version');
    setVersionParam(v ? parseInt(v, 10) : null);
  }, []);

  const canEditConfig = wf?.status !== 'archived' && !isViewingHistory;

  const handleSaveConfig = async () => {
    if (!wf) return;
    let inputSchema, outputSchema;
    try { inputSchema = JSON.parse(inputSchemaDraft); } catch { /* keep existing */ }
    try { outputSchema = JSON.parse(outputSchemaDraft); } catch { /* keep existing */ }
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
    if (!wf) return;
    setYamlDraft(wf.yaml_content);
    setInputSchemaDraft(JSON.stringify(wf.input_schema, null, 2));
    setOutputSchemaDraft(JSON.stringify(wf.output_schema, null, 2));
    setConfigEditing(false);
  };

  const handleDeploy = async () => {
    if (!wf) return;
    // Always deploy (updates deployed_content_version), then activate
    await deployMutation.mutateAsync(wf.id);
    await activateMutation.mutateAsync(wf.id);
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflow'], refetchType: 'all' });
    refetch();
  };

  const handleRegenerate = async () => {
    await regenerateMutation.mutateAsync({
      id: yamlId,
      compilation_feedback: feedbackText.trim() || undefined,
    });
    setFeedbackText('');
    setShowFeedback(false);
    refetch();
  };

  if (!wf) return <p className="text-sm text-text-secondary animate-pulse">Loading workflow...</p>;

  const isPending = deployMutation.isPending || activateMutation.isPending || archiveMutation.isPending || regenerateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-8">
      {/* Left: config */}
      <div>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-light text-text-primary">
              {wf.status === 'active' ? 'Redeploy' : 'Deploy'} Workflow
            </h2>
            <p className="text-xs text-text-tertiary mt-0.5">Review configuration, input/output schemas, and YAML definition</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={() => { setShowFeedback(!showFeedback); setConfigEditing(false); }}
              className={`inline-flex items-center gap-1 text-xs transition-colors hover:underline ${showFeedback ? 'text-accent font-medium' : 'text-accent/70 hover:text-accent'}`}>
              <MessageSquarePlus className="w-3 h-3" />
              Recompile with Feedback
            </button>
            <span className="text-text-tertiary/30">|</span>
            <button type="button" onClick={() => { setConfigEditing(!configEditing); setShowFeedback(false); }}
              className={`inline-flex items-center gap-1 text-xs transition-colors hover:underline ${configEditing ? 'text-accent font-medium' : 'text-accent/70 hover:text-accent'}`}>
              <Pencil className="w-3 h-3" />
              Manual Edit
            </button>
          </div>
        </div>

        {/* Recompile feedback panel */}
        {showFeedback && (
          <div className="mb-4 p-4 bg-surface-sunken border border-surface-border rounded-lg">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">What should change?</p>
            <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="E.g.: 'Only url, username, password, and screenshot_dir should be dynamic inputs. The steps array and script are implementation details.'"
              className="w-full min-h-[80px] px-3 py-2 bg-surface border border-surface-border rounded-md text-xs text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" />
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] text-text-tertiary">This feedback guides the compiler. The current YAML will be replaced.</p>
              <button onClick={handleRegenerate} disabled={!feedbackText.trim() || regenerateMutation.isPending} className="btn-primary text-xs shrink-0 ml-4">
              {regenerateMutation.isPending ? 'Recompiling...' : 'Recompile Pipeline'}
            </button>
            </div>
          </div>
        )}

        {/* Version history banner */}
        {isViewingHistory && (
          <div className="mb-4 px-3 py-2 bg-accent-muted/20 border border-accent-muted/40 rounded-md flex items-center justify-between">
            <span className="text-xs text-accent">Viewing version {versionParam}</span>
            <button onClick={() => setVersionParam(null)} className="text-xs text-accent hover:underline">Back to current</button>
          </div>
        )}

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
          isCollapsed={false}
          onToggle={() => {}}
          schemasGrid
        />

        <WizardNav>
          <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
          {wf.status === 'active'
            ? <button onClick={onAdvance} disabled={showFeedback} className="btn-primary text-xs">Next: Test</button>
            : <button onClick={handleDeploy} disabled={isPending || showFeedback} className="btn-primary text-xs">{isPending ? 'Deploying...' : 'Deploy & Activate'}</button>
          }
        </WizardNav>
      </div>

      {/* Right: lifecycle + versions — sticky on scroll */}
      <div className="space-y-6">
        <div className="sticky top-6">
        <LifecycleSidebar
          status={wf.status}
          sourceWorkflowId={wf.source_workflow_id}
          contentVersion={wf.content_version}
          deployedContentVersion={wf.deployed_content_version}
          onDeploy={handleDeploy}
          onArchive={() => archiveMutation.mutateAsync(yamlId).then(() => refetch())}
          onDelete={() => deleteMutation.mutateAsync(yamlId)}
          onRegenerate={handleRegenerate}
          isPending={isPending}
          error={undefined}
        />
        {(versionsData?.versions?.length ?? 0) > 1 && (
          <VersionHistory
            versionsData={versionsData}
            searchParams={versionSearchParams}
            setSearchParams={setVersionSearchParams}
            currentVersion={wf.content_version}
            viewingVersion={isViewingHistory ? versionParam : null}
          />
        )}
        </div>{/* end sticky */}
      </div>
    </div>
  );
}
