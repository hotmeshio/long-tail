import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { TagInput } from '../../../components/common/form/TagInput';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { Field } from '../../../components/common/data/Field';
import { useUpdateYamlWorkflow } from '../../../api/yaml-workflows';
import type { LTYamlWorkflowRecord, ActivityManifestEntry } from '../../../api/types/yaml-workflows';

export function HeaderCard({
  wf,
  workerActivities,
  isActive,
  isViewingHistory,
  versionsData,
  onOpenInvoke,
}: {
  wf: LTYamlWorkflowRecord;
  workerActivities: ActivityManifestEntry[];
  isActive: boolean;
  isViewingHistory: boolean | 0 | null | undefined;
  versionsData: { total: number } | undefined;
  onOpenInvoke: () => void;
}) {
  const queryClient = useQueryClient();
  const updateMutation = useUpdateYamlWorkflow();

  return (
    <div className="bg-surface-raised border border-surface-border rounded-md p-5 mb-8">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-medium text-text-primary font-mono truncate flex-1">{wf.name}</h2>
        <StatusBadge status={wf.status} />
        {isActive && !isViewingHistory && (
          <button
            type="button"
            onClick={onOpenInvoke}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
          >
            <Play className="w-3 h-3" />
            Invoke
          </button>
        )}
      </div>

      {wf.description && <p className="text-xs text-text-secondary mb-4">{wf.description}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-8">
        <Field label="Tool Server" value={<span className="font-mono text-xs">{wf.app_id}</span>} />
        <Field label="Pipeline Tool" value={<span className="font-mono text-xs">{wf.graph_topic}</span>} />
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
                Open in Compilation Wizard
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
  );
}
