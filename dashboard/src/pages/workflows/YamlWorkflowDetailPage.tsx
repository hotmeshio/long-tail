import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
  useInvokeYamlWorkflow,
  useArchiveYamlWorkflow,
  useDeleteYamlWorkflow,
} from '../../api/yaml-workflows';
import { StatusBadge } from '../../components/common/StatusBadge';
import { JsonViewer } from '../../components/common/JsonViewer';
import { PageHeader } from '../../components/common/PageHeader';
import { Field } from '../../components/common/Field';

const statusMap: Record<string, string> = {
  draft: 'pending',
  deployed: 'in_progress',
  active: 'completed',
  archived: 'failed',
};

export function YamlWorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: wf, isLoading, refetch } = useYamlWorkflow(id!);
  const deployMutation = useDeployYamlWorkflow();
  const activateMutation = useActivateYamlWorkflow();
  const invokeMutation = useInvokeYamlWorkflow();
  const archiveMutation = useArchiveYamlWorkflow();
  const deleteMutation = useDeleteYamlWorkflow();
  const [invokeInput, setInvokeInput] = useState('{}');
  const [invokeResult, setInvokeResult] = useState<Record<string, unknown> | null>(null);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!wf) {
    return <p className="text-sm text-text-secondary">YAML workflow not found.</p>;
  }

  const workerActivities = wf.activity_manifest.filter((a) => a.type === 'worker');
  const error =
    deployMutation.error?.message ||
    activateMutation.error?.message ||
    invokeMutation.error?.message ||
    archiveMutation.error?.message ||
    deleteMutation.error?.message;

  const handleDeploy = async () => {
    await deployMutation.mutateAsync(wf.id);
    refetch();
  };

  const handleActivate = async () => {
    await activateMutation.mutateAsync(wf.id);
    refetch();
  };

  const handleArchive = async () => {
    if (!confirm('Archive this workflow? It will no longer accept invocations.')) return;
    await archiveMutation.mutateAsync(wf.id);
    refetch();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this workflow permanently?')) return;
    await deleteMutation.mutateAsync(wf.id);
  };

  const handleInvoke = async () => {
    try {
      const data = JSON.parse(invokeInput);
      const result = await invokeMutation.mutateAsync({ id: wf.id, data, sync: true });
      setInvokeResult(result);
    } catch (err: any) {
      setInvokeResult({ error: err.message });
    }
  };

  return (
    <div>
      <PageHeader
        title="YAML Workflow"
        backTo="/workflows/yaml"
        backLabel="YAML Workflows"
      />

      {/* Header */}
      <div className="px-6 py-6 mb-6">
        <div className="flex items-center gap-4 mb-5">
          <h2 className="text-lg font-medium text-text-primary font-mono truncate flex-1">
            {wf.name}
          </h2>
          <StatusBadge status={statusMap[wf.status] ?? wf.status} />
        </div>

        {wf.description && (
          <p className="text-xs text-text-secondary mb-4">{wf.description}</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 gap-x-8 mb-5">
          <Field label="App ID" value={<span className="font-mono text-xs">{wf.app_id}</span>} />
          <Field label="Version" value={<span className="font-mono text-xs">{wf.app_version}</span>} />
          <Field label="Graph Topic" value={<span className="font-mono text-xs">{wf.graph_topic}</span>} />
          <Field label="Activities" value={<span className="text-xs">{workerActivities.length} workers</span>} />
          {wf.source_workflow_type && (
            <Field
              label="Source Type"
              value={<span className="font-mono text-xs">{wf.source_workflow_type}</span>}
            />
          )}
          {wf.source_workflow_id && (
            <Field
              label="Source Execution"
              value={
                <Link
                  to={`/workflows/detail/${wf.source_workflow_id}`}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {wf.source_workflow_id}
                </Link>
              }
            />
          )}
          <Field label="Created" value={<span className="text-xs">{new Date(wf.created_at).toLocaleString()}</span>} />
          <Field label="Status" value={<span className="text-xs capitalize">{wf.status}</span>} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-4 border-t border-surface-border">
          {wf.status === 'draft' && (
            <button
              onClick={handleDeploy}
              disabled={deployMutation.isPending}
              className="btn-primary text-xs"
            >
              {deployMutation.isPending ? 'Deploying...' : 'Deploy'}
            </button>
          )}
          {(wf.status === 'deployed' || wf.status === 'active') && (
            <button
              onClick={handleActivate}
              disabled={activateMutation.isPending}
              className="btn-primary text-xs"
            >
              {activateMutation.isPending ? 'Activating...' : 'Activate'}
            </button>
          )}
          {wf.status === 'active' && (
            <button
              onClick={handleArchive}
              disabled={archiveMutation.isPending}
              className="btn-secondary text-xs"
            >
              Archive
            </button>
          )}
          {(wf.status === 'draft' || wf.status === 'archived') && (
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="text-xs text-status-error hover:underline"
            >
              Delete
            </button>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-status-error">{error}</p>
        )}
      </div>

      {/* Activity Manifest */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-text-primary mb-3 px-1">Activity Pipeline</h3>
        <div className="space-y-2">
          {workerActivities.map((activity, idx) => (
            <div key={activity.activity_id} className="flex items-center gap-3 p-3 bg-surface-sunken rounded-md">
              <span className="text-[10px] font-mono text-text-tertiary w-6">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-medium text-text-primary">{activity.title}</p>
                <p className="text-[10px] text-text-tertiary font-mono truncate">
                  {activity.tool_source === 'db' ? 'db' : activity.mcp_server_id}/{activity.mcp_tool_name} → {activity.topic}
                </p>
              </div>
              {Object.keys(activity.input_mappings).length > 0 && (
                <span className="text-[10px] text-text-tertiary">
                  {Object.keys(activity.input_mappings).length} mappings
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input/Output Schemas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <JsonViewer data={wf.input_schema} label="Input Schema" />
        <JsonViewer data={wf.output_schema} label="Output Schema" />
      </div>

      {/* Invoke Section (only when active) */}
      {wf.status === 'active' && (
        <div className="mb-6 p-4 bg-surface-sunken rounded-md space-y-3">
          <h3 className="text-sm font-medium text-text-primary">Invoke Workflow</h3>
          <textarea
            value={invokeInput}
            onChange={(e) => setInvokeInput(e.target.value)}
            className="input w-full font-mono text-xs h-24"
            placeholder="Enter JSON input..."
          />
          <button
            onClick={handleInvoke}
            disabled={invokeMutation.isPending}
            className="btn-primary text-xs"
          >
            {invokeMutation.isPending ? 'Running...' : 'Invoke (Sync)'}
          </button>
          {invokeResult && (
            <JsonViewer data={invokeResult} label="Result" />
          )}
        </div>
      )}

      {/* YAML Content */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-text-primary mb-3 px-1">YAML Definition</h3>
        <pre className="p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre max-h-[600px] overflow-y-auto">
          {wf.yaml_content}
        </pre>
      </div>
    </div>
  );
}
