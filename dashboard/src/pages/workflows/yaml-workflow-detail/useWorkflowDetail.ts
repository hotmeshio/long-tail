import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { useSettings } from '../../../api/settings';
import { buildSkeleton } from './helpers';
import type { Section } from './helpers';
import type { InputFieldMeta } from '../../../api/types/yaml-workflows';

export function useWorkflowDetail() {
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

  const resolvedManifest = isViewingHistory && versionSnapshot ? versionSnapshot.activity_manifest : wf?.activity_manifest;
  const resolvedInputSchema = isViewingHistory && versionSnapshot ? versionSnapshot.input_schema : wf?.input_schema;
  const resolvedOutputSchema = isViewingHistory && versionSnapshot ? versionSnapshot.output_schema : wf?.output_schema;
  const resolvedYaml = isViewingHistory && versionSnapshot ? versionSnapshot.yaml_content : wf?.yaml_content;

  // ── Configuration editing state ─────────────────────────────
  const [yamlDraft, setYamlDraft] = useState('');
  const [inputSchemaDraft, setInputSchemaDraft] = useState('');
  const [outputSchemaDraft, setOutputSchemaDraft] = useState('');
  const [inputFieldMetaDraft, setInputFieldMetaDraft] = useState<InputFieldMeta[]>([]);
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

  const workerActivities = (resolvedManifest ?? wf?.activity_manifest ?? []).filter((a) => a.type === 'worker');
  const lifecycleError =
    deployMutation.error?.message || activateMutation.error?.message ||
    archiveMutation.error?.message || deleteMutation.error?.message ||
    regenerateMutation.error?.message;
  const lifecyclePending =
    deployMutation.isPending || activateMutation.isPending ||
    archiveMutation.isPending || deleteMutation.isPending ||
    regenerateMutation.isPending;

  const handleDeploy = async () => { await deployMutation.mutateAsync(wf!.id); refetch(); };

  const handleArchive = async () => {
    if (!confirm('Archive this workflow server? It will no longer accept invocations.')) return;
    await archiveMutation.mutateAsync(wf!.id); refetch();
  };
  const handleDelete = async () => {
    if (!confirm('Delete this workflow server permanently?')) return;
    await deleteMutation.mutateAsync(wf!.id);
  };
  const handleRegenerate = async () => {
    if (!confirm('Re-generate from the source execution? This will overwrite the current definition.')) return;
    await regenerateMutation.mutateAsync({ id: wf!.id }); refetch();
  };
  const handleSaveConfig = async () => {
    let inputSchema: Record<string, unknown> | undefined;
    let outputSchema: Record<string, unknown> | undefined;
    try { inputSchema = JSON.parse(inputSchemaDraft); } catch { /* keep current */ }
    try { outputSchema = JSON.parse(outputSchemaDraft); } catch { /* keep current */ }
    await updateMutation.mutateAsync({
      id: wf!.id,
      yaml_content: yamlDraft,
      ...(inputSchema ? { input_schema: inputSchema } : {}),
      ...(outputSchema ? { output_schema: outputSchema } : {}),
    });
    setConfigEditing(false);
    refetch();
  };
  const handleCancelEdit = () => {
    setYamlDraft(wf!.yaml_content);
    setInputSchemaDraft(JSON.stringify(wf!.input_schema, null, 2));
    setOutputSchemaDraft(JSON.stringify(wf!.output_schema, null, 2));
    setConfigEditing(false);
  };
  const handleInvoke = async () => {
    setInvokeResult(null);
    try {
      const data = invokeJsonMode ? JSON.parse(invokeJson) : invokeFields;
      const result = await invokeMutation.mutateAsync({ id: wf!.id, data, sync: true });
      setInvokeResult(result);
    } catch (err: any) {
      setInvokeResult({ error: err.message });
    }
  };

  const isActive = wf?.status === 'active' || wf?.status === 'deployed';
  const canEditConfig = wf?.status !== 'archived' && !isViewingHistory;
  const showInvoke = isActive && !isViewingHistory;
  const toggleSection = (key: string) => setOpenSection(openSection === key ? null : key as Section);

  return {
    wf,
    isLoading,
    settings,
    searchParams,
    setSearchParams,
    viewingVersion,
    isViewingHistory,
    versionSnapshot,
    versionsData,
    resolvedInputSchema,
    resolvedOutputSchema,
    resolvedYaml,
    workerActivities,
    lifecycleError,
    lifecyclePending,
    invokeFields,
    setInvokeFields,
    invokeJsonMode,
    setInvokeJsonMode,
    invokeJson,
    setInvokeJson,
    invokeResult,
    setInvokeResult,
    showMetadata,
    setShowMetadata,
    openSection,
    selectedStep,
    setSelectedStep,
    configEditing,
    setConfigEditing,
    canEditConfig,
    showInvoke,
    isActive,
    yamlDraft,
    setYamlDraft,
    inputSchemaDraft,
    setInputSchemaDraft,
    outputSchemaDraft,
    setOutputSchemaDraft,
    inputFieldMetaDraft,
    setInputFieldMetaDraft,
    yamlTextareaRef,
    updateMutation,
    invokeMutation,
    handleDeploy,
    handleArchive,
    handleDelete,
    handleRegenerate,
    handleSaveConfig,
    handleCancelEdit,
    handleInvoke,
    toggleSection,
  };
}
