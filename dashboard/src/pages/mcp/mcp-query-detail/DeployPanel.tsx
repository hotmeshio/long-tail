import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MessageSquarePlus, Pencil, X, Check } from 'lucide-react';
import { SecondaryAction } from '../../../components/common/display/SecondaryAction';
import { useQueryClient } from '@tanstack/react-query';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { YamlComposer } from '../../../components/common/data/YamlComposer';
import { DagNodeDetail } from '../../../components/common/data/DagNodeDetail';
import { LifecycleSidebar } from './LifecycleSidebar';
import { VersionHistory } from './VersionHistory';
import { RecompileFeedbackPanel } from './RecompileFeedbackPanel';
import {
  useYamlWorkflow,
  useYamlWorkflows,
  useYamlWorkflowVersions,
  useYamlWorkflowVersion,
  useUpdateYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
  useArchiveYamlWorkflow,
  useRestoreYamlWorkflow,
  useRegenerateYamlWorkflow,
  useDeleteYamlWorkflow,
} from '../../../api/yaml-workflows';
import type { ActivityManifestEntry, InputFieldMeta } from '../../../api/types';

interface DeployPanelProps {
  yamlId: string;
  onAdvance: () => void;
  onBack: () => void;
  /** Override the default regeneration pathway. When provided, called instead of the compilation-based regenerate endpoint. */
  onRegenerate?: (feedback: string) => void;
  regeneratePending?: boolean;
}

export function DeployPanel({ yamlId, onAdvance, onBack, onRegenerate, regeneratePending }: DeployPanelProps) {
  const queryClient = useQueryClient();
  const yamlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [dismissingFeedback, setDismissingFeedback] = useState(false);

  const closeFeedback = () => {
    setDismissingFeedback(true);
    setTimeout(() => { setShowFeedback(false); setDismissingFeedback(false); }, 250);
  };

  const { data: wf, refetch } = useYamlWorkflow(yamlId);
  const { data: siblingsData } = useYamlWorkflows(wf ? { app_id: wf.app_id } : {});
  const siblingCount = siblingsData?.workflows?.length ?? 0;
  const currentAppVersion = Math.max(...(siblingsData?.workflows?.map(w => parseInt(w.app_version || '0', 10)) ?? [0]));
  const { data: versionsData } = useYamlWorkflowVersions(yamlId);

  const deployMutation = useDeployYamlWorkflow();
  const activateMutation = useActivateYamlWorkflow();
  const archiveMutation = useArchiveYamlWorkflow();
  const restoreMutation = useRestoreYamlWorkflow();
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

  // DAG node selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const resolvedManifest: ActivityManifestEntry[] = (isViewingHistory && versionSnapshot)
    ? versionSnapshot.activity_manifest : wf?.activity_manifest ?? [];
  const selectedEntry = useMemo(
    () => resolvedManifest.find((e) => e.activity_id === selectedNodeId) ?? null,
    [resolvedManifest, selectedNodeId],
  );

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
    await deployMutation.mutateAsync(wf.id);
    await activateMutation.mutateAsync(wf.id);
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflow'], refetchType: 'all' });
    refetch();
    onAdvance();
  };

  const handleRegenerate = async () => {
    if (onRegenerate) {
      onRegenerate(feedbackText.trim());
      setFeedbackText('');
      setShowFeedback(false);
      return;
    }
    await regenerateMutation.mutateAsync({
      id: yamlId,
      compilation_feedback: feedbackText.trim() || undefined,
    });
    setFeedbackText('');
    setShowFeedback(false);
    refetch();
  };

  if (!wf) return <p className="text-sm text-text-secondary animate-pulse">Loading workflow...</p>;

  const isPending = deployMutation.isPending || activateMutation.isPending || archiveMutation.isPending || restoreMutation.isPending || regenerateMutation.isPending || deleteMutation.isPending || !!regeneratePending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
      {/* Left: config */}
      <div className="min-w-0 overflow-hidden">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-extralight tracking-wide text-accent/75 mb-1">Deploy</h2>
            <p className="text-base text-text-secondary">
              Review and edit the workflow definition. Re/deploy when ready.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {configEditing ? (
              <>
                <SecondaryAction icon={X} label="Cancel" onClick={() => { handleCancelEdit(); setConfigEditing(false); }} />
                <SecondaryAction
                  icon={Check}
                  label={updateMutation.isPending ? 'Saving...' : 'Save'}
                  onClick={handleSaveConfig}
                  disabled={updateMutation.isPending || (
                    yamlDraft === wf.yaml_content
                    && inputSchemaDraft === JSON.stringify(wf.input_schema, null, 2)
                    && outputSchemaDraft === JSON.stringify(wf.output_schema, null, 2)
                  )}
                />
              </>
            ) : (
              <>
                <SecondaryAction icon={MessageSquarePlus} label="Recompile with Feedback" onClick={() => { setShowFeedback(!showFeedback); }} />
                <SecondaryAction icon={Pencil} label="Manual Edit" onClick={() => { setConfigEditing(true); setShowFeedback(false); }} />
              </>
            )}
          </div>
        </div>

        {/* Recompile feedback panel */}
        {showFeedback && (
          <RecompileFeedbackPanel
            feedbackText={feedbackText}
            setFeedbackText={setFeedbackText}
            dismissing={dismissingFeedback}
            onClose={closeFeedback}
            onRegenerate={handleRegenerate}
            isPending={regenerateMutation.isPending}
          />
        )}

        {/* Version history banner */}
        {isViewingHistory && (
          <div className="mb-4 px-3 py-2 bg-accent-muted/20 border border-accent-muted/40 rounded-md flex items-center justify-between">
            <span className="text-xs text-accent">Viewing version {versionParam}</span>
            <button onClick={() => setVersionParam(null)} className="text-xs text-accent hover:underline">Back to current</button>
          </div>
        )}

        <YamlComposer
          yamlContent={resolvedYaml}
          activityManifest={resolvedManifest}
          inputSchema={resolvedInputSchema}
          outputSchema={resolvedOutputSchema}
          wf={wf}
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
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
        />

        <WizardNav>
          <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
          {wf.status === 'active'
            ? <button onClick={onAdvance} disabled={showFeedback} className="btn-primary text-xs">Next: Test</button>
            : <button onClick={handleDeploy} disabled={isPending || showFeedback} className="btn-primary text-xs">{isPending ? 'Deploying...' : 'Deploy & Activate'}</button>
          }
        </WizardNav>
      </div>

      {/* Right sidebar */}
      <div className="space-y-6">
        <div className="sticky top-6">
        {selectedEntry ? (
          <DagNodeDetail
            entry={selectedEntry}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : (
          <>
            <LifecycleSidebar
              status={wf.status}
              sourceWorkflowId={wf.source_workflow_id}
              contentVersion={wf.content_version}
              deployedContentVersion={wf.deployed_content_version}
              appId={wf.app_id}
              appVersion={currentAppVersion}
              siblingCount={siblingCount}
              onDeploy={handleDeploy}
              onArchive={() => archiveMutation.mutateAsync(yamlId).then(() => refetch())}
              onRestore={() => restoreMutation.mutateAsync(yamlId).then(() => refetch())}
              onDelete={async () => {
                await deleteMutation.mutateAsync(yamlId);
                queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
                onBack();
              }}
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
          </>
        )}
        </div>
      </div>
    </div>
  );
}
