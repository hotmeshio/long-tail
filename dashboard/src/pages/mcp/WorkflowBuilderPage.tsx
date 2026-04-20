import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hammer, MessageSquare, Layers } from 'lucide-react';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { TimestampCell } from '../../components/common/display/TimestampCell';
import { ElapsedCell } from '../../components/common/display/ElapsedCell';
import { EmptyState } from '../../components/common/display/EmptyState';
import { RowActionGroup } from '../../components/common/layout/RowActions';
import { useBuilderJobs, useSubmitBuildWorkflow } from '../../api/workflow-builder';
import type { LTJob } from '../../api/types';

const STATUS_DOT: Record<string, string> = {
  in_progress: 'bg-status-active',
  completed: 'bg-status-success',
  failed: 'bg-status-error',
};

function mapStatus(job: LTJob): string {
  if (job.status === 'completed') return 'completed';
  if (Number(job.status) === 0) return 'completed';
  if (job.is_live) return 'in_progress';
  return 'failed';
}

const PAGE_SIZE = 20;

export default function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [promptText, setPromptText] = useState('');
  const [showComposer, setShowComposer] = useState(false);

  const { data, isLoading, refetch } = useBuilderJobs({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const submitBuild = useSubmitBuildWorkflow();

  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSubmit = async () => {
    const prompt = promptText.trim();
    if (!prompt) return;
    const result = await submitBuild.mutateAsync({ prompt });
    setPromptText('');
    setShowComposer(false);
    navigate(`/mcp/builder/${result.workflow_id}`);
  };

  const columns: Column<LTJob>[] = [
    {
      key: 'workflow_id',
      label: 'Build ID',
      render: (row) => {
        const s = mapStatus(row);
        const dotClass = STATUS_DOT[s] ?? 'bg-status-pending';
        const pulseClass = s === 'in_progress' ? ' animate-pulse' : '';
        return (
          <div className="flex items-start gap-2 min-w-0">
            <span className={`w-[9px] h-[9px] shrink-0 rounded-full mt-1 ${dotClass}${pulseClass}`} title={s} />
            <span className="font-mono text-xs text-text-primary truncate block">{row.workflow_id}</span>
          </div>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => <TimestampCell date={row.created_at} />,
      className: 'w-40',
      sortable: true,
    },
    {
      key: 'updated_at',
      label: 'Updated',
      render: (row) => <TimestampCell date={row.updated_at} />,
      className: 'w-40',
      sortable: true,
    },
    {
      key: 'duration',
      label: 'Duration',
      render: (row) => {
        const s = mapStatus(row);
        return (
          <ElapsedCell
            startDate={row.created_at}
            endDate={s === 'in_progress' ? null : row.updated_at}
            isLive={s === 'in_progress'}
          />
        );
      },
      className: 'w-32',
    },
    {
      key: 'actions',
      label: '',
      className: 'w-20',
      render: (row) => (
        <RowActionGroup>
          <button
            className="opacity-0 group-hover/row:opacity-100 p-1 rounded hover:bg-surface-raised transition-all"
            onClick={(e) => { e.stopPropagation(); navigate(`/mcp/builder/${row.workflow_id}`); }}
            title="View build"
          >
            <MessageSquare className="w-3.5 h-3.5 text-accent" strokeWidth={1.5} />
          </button>
          {mapStatus(row) === 'completed' && (
            <button
              className="opacity-0 group-hover/row:opacity-100 p-1 rounded hover:bg-surface-raised transition-all"
              onClick={(e) => { e.stopPropagation(); navigate(`/mcp/builder/${row.workflow_id}?step=3`); }}
              title="Deploy"
            >
              <Layers className="w-3.5 h-3.5 text-status-success" strokeWidth={1.5} />
            </button>
          )}
        </RowActionGroup>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Workflow Builder"
        actions={
          <div className="flex items-center gap-2">
            <ListToolbar onRefresh={() => refetch()} apiPath="/workflow-states/jobs?entity=mcpWorkflowBuilder&limit=20&sort_by=created_at&order=desc" />
            <button
              onClick={() => setShowComposer(!showComposer)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
            >
              <Hammer className="w-3.5 h-3.5" strokeWidth={1.5} />
              Build Workflow
            </button>
          </div>
        }
      />

      {showComposer && (
        <div className="mb-6 rounded-lg border border-surface-border bg-surface-raised p-4">
          <p className="text-sm text-text-secondary mb-3">
            Describe the workflow you want to build. The LLM will discover available tools and construct a HotMesh YAML DAG directly.
          </p>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Take a screenshot of a webpage, analyze the content, and save the description to the knowledge store..."
            className="w-full min-h-[100px] px-3 py-2 bg-surface text-sm text-text-primary placeholder:text-text-tertiary rounded-md border border-surface-border resize-none focus:outline-none focus:ring-1 focus:ring-accent"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={handleSubmit}
              disabled={!promptText.trim() || submitBuild.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Hammer className="w-3 h-3" />
              {submitBuild.isPending ? 'Building...' : 'Build'}
            </button>
          </div>
        </div>
      )}

      {!isLoading && jobs.length === 0 ? (
        <EmptyState title="No workflow builds yet" />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={jobs}
            keyFn={(row) => row.workflow_id}
            onRowClick={(row) => navigate(`/mcp/builder/${row.workflow_id}`)}
          />
          {totalPages > 1 && (
            <StickyPagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
