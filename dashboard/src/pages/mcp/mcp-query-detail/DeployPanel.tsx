import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MessageSquarePlus, Pencil, X, Check } from 'lucide-react';
import { SecondaryAction } from '../../../components/common/display/SecondaryAction';
import { useQueryClient } from '@tanstack/react-query';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { YamlComposer } from '../../../components/common/data/YamlComposer';
import { DagNodeDetail } from '../../../components/common/data/DagNodeDetail';
import { LifecycleSidebar } from './LifecycleSidebar';
import { VersionHistory } from './VersionHistory';
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

  // DAG node selection — drives right sidebar content
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
    // Always deploy (updates deployed_content_version), then activate
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

  const isPending = deployMutation.isPending || activateMutation.isPending || archiveMutation.isPending || regenerateMutation.isPending || deleteMutation.isPending || !!regeneratePending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
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
          <div
            className="mb-4 p-4 bg-surface-sunken border border-surface-border rounded-lg overflow-hidden transition-all duration-250 ease-in-out"
            style={{
              animation: dismissingFeedback ? undefined : 'fadeIn 300ms ease-out both',
              opacity: dismissingFeedback ? 0 : 1,
              maxHeight: dismissingFeedback ? '0px' : '400px',
              paddingTop: dismissingFeedback ? '0px' : undefined,
              paddingBottom: dismissingFeedback ? '0px' : undefined,
              marginBottom: dismissingFeedback ? '0px' : undefined,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">What should change?</p>
              <button onClick={closeFeedback} className="text-text-tertiary hover:text-text-secondary transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
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

      {/* Right sidebar — swaps between lifecycle tools and node properties */}
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
              onDeploy={handleDeploy}
              onArchive={() => archiveMutation.mutateAsync(yamlId).then(() => refetch())}
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
        </div>{/* end sticky */}
      </div>
    </div>
  );
}
