import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
    if (wf.status === 'draft') await deployMutation.mutateAsync(wf.id);
    await activateMutation.mutateAsync(wf.id);
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
    refetch();
  };

  const handleRegenerate = async () => {
    await regenerateMutation.mutateAsync({ id: yamlId });
    refetch();
  };

  if (!wf) return <p className="text-sm text-text-secondary animate-pulse">Loading workflow...</p>;

  const isPending = deployMutation.isPending || activateMutation.isPending || archiveMutation.isPending || regenerateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-8">
      {/* Left: config */}
      <div>
        <div className="mb-6">
          <h2 className="text-lg font-light text-text-primary">
            {wf.status === 'active' ? 'Redeploy' : 'Deploy'} Workflow
          </h2>
          <p className="text-xs text-text-tertiary mt-0.5">Edit configuration, input/output schemas, and YAML definition</p>
        </div>

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
            ? <button onClick={onAdvance} className="btn-primary text-xs">Next: Test</button>
            : <button onClick={handleDeploy} disabled={isPending} className="btn-primary text-xs">{isPending ? 'Deploying...' : 'Deploy & Activate'}</button>
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
