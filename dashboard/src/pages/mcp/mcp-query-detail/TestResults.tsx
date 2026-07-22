import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { SectionHeading } from './SectionHeading';
import type { LTJob } from '../../../api/types';

function jobLabel(job: LTJob): string {
  const date = new Date(job.created_at);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const status = job.status === 'completed' || Number(job.status) === 0 ? 'completed' : job.is_live ? 'running' : 'failed';
  return `${day} ${time} — ${status}`;
}

interface TestResultsBuilderProps {
  jobs: LTJob[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  deterministicInput: unknown;
  deterministicOutput: unknown;
  inputSchema: any;
  runLoading: boolean;
  selectedRunExecution: any;
}

export function TestResultsBuilder({
  jobs,
  selectedRunId,
  onSelectRun,
  deterministicInput,
  deterministicOutput,
  inputSchema,
  runLoading,
  selectedRunExecution,
}: TestResultsBuilderProps) {
  return (
    <>
      {/* Run selector */}
      {jobs.length > 0 && selectedRunId && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">Pipeline Run</p>
          <select
            value={selectedRunId}
            onChange={(e) => onSelectRun(e.target.value)}
            className="bg-transparent border-none text-2xs text-accent hover:text-accent/80 cursor-pointer focus:outline-none p-0 text-right"
          >
            {jobs.map((job) => <option key={job.workflow_id} value={job.workflow_id}>{jobLabel(job)}</option>)}
          </select>
        </div>
      )}

      <SectionHeading>Input</SectionHeading>
      <div className="mb-6">
        {deterministicInput ? (
          <JsonViewer data={deterministicInput} defaultMode="tree" />
        ) : selectedRunId && inputSchema ? (
          <JsonViewer data={inputSchema} defaultMode="tree" />
        ) : (
          <p className="text-xs text-text-tertiary italic">No runs yet — click "Run Test" to invoke the pipeline</p>
        )}
      </div>

      <SectionHeading>Output</SectionHeading>
      <div className="mb-6">
        {deterministicOutput ? (
          <JsonViewer data={deterministicOutput} defaultMode="tree" />
        ) : selectedRunId && runLoading ? (
          <p className="text-xs text-text-tertiary animate-pulse">Loading...</p>
        ) : selectedRunId && selectedRunExecution ? (
          <JsonViewer data={selectedRunExecution.result ?? selectedRunExecution} defaultMode="tree" />
        ) : selectedRunId ? (
          <p className="text-xs text-text-tertiary animate-pulse">Loading...</p>
        ) : (
          <p className="text-xs text-text-tertiary italic">No runs yet</p>
        )}
        {selectedRunExecution?.duration_ms != null && (
          <p className="text-2xs text-text-tertiary mt-2">{(selectedRunExecution.duration_ms / 1000).toFixed(1)}s</p>
        )}
      </div>
    </>
  );
}

interface TestResultsComparisonProps {
  jobs: LTJob[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  originalEnvelope: any;
  resolvedPrompt: string | undefined;
  originalOutput: unknown;
  originalDurationMs: number | null | undefined;
  deterministicInput: unknown;
  deterministicOutput: unknown;
  inputSchema: any;
  runLoading: boolean;
  selectedRunExecution: any;
}

export function TestResultsComparison({
  jobs,
  selectedRunId,
  onSelectRun,
  originalEnvelope,
  resolvedPrompt,
  originalOutput,
  originalDurationMs,
  deterministicInput,
  deterministicOutput,
  inputSchema,
  runLoading,
  selectedRunExecution,
}: TestResultsComparisonProps) {
  return (
    <>
      {/* Grid-aligned comparison: column headers */}
      <div className="grid grid-cols-2 gap-8 mb-4">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">Original MCP Query</p>
          <p className="text-2xs text-text-tertiary mt-0.5">Dynamic LLM orchestration</p>
        </div>
        <div className="text-right">
          <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">Compiled Pipeline Run</p>
          {jobs.length > 0 && selectedRunId && (
            <select
              value={selectedRunId}
              onChange={(e) => onSelectRun(e.target.value)}
              className="mt-0.5 bg-transparent border-none text-2xs text-accent hover:text-accent/80 cursor-pointer focus:outline-none p-0 text-right direction-rtl"
            >
              {jobs.map((job) => <option key={job.workflow_id} value={job.workflow_id}>{jobLabel(job)}</option>)}
            </select>
          )}
          {!selectedRunId && <p className="text-2xs text-text-tertiary mt-0.5">No runs yet</p>}
        </div>
      </div>

      {/* Row 1: Inputs */}
      <SectionHeading>Input</SectionHeading>
      <div className="grid grid-cols-1 @split:grid-cols-2 gap-8 mb-6">
        <div>
          {originalEnvelope ? (
            <JsonViewer data={originalEnvelope} defaultMode="tree" />
          ) : resolvedPrompt ? (
            <p className="text-xs text-text-primary leading-relaxed px-3 py-2 bg-surface-sunken rounded-md">{resolvedPrompt}</p>
          ) : (
            <p className="text-xs text-text-tertiary italic">Loading...</p>
          )}
        </div>
        <div>
          {deterministicInput ? (
            <JsonViewer data={deterministicInput} defaultMode="tree" />
          ) : selectedRunId && inputSchema ? (
            <div>
              <p className="text-2xs text-text-tertiary italic mb-1">Stored defaults</p>
              <JsonViewer data={inputSchema} defaultMode="tree" />
            </div>
          ) : (
            <p className="text-xs text-text-tertiary italic">No runs yet</p>
          )}
        </div>
      </div>

      {/* Row 2: Outputs */}
      <SectionHeading>Output</SectionHeading>
      <div className="grid grid-cols-1 @split:grid-cols-2 gap-8 mb-6">
        <div>
          {originalOutput ? (
            <JsonViewer data={originalOutput} defaultMode="tree" />
          ) : (
            <p className="text-xs text-text-tertiary italic">No output</p>
          )}
          {originalDurationMs != null && (
            <p className="text-2xs text-text-tertiary mt-2">{(originalDurationMs / 1000).toFixed(1)}s</p>
          )}
        </div>
        <div>
          {deterministicOutput ? (
            <JsonViewer data={deterministicOutput} defaultMode="tree" />
          ) : selectedRunId && runLoading ? (
            <p className="text-xs text-text-tertiary animate-pulse">Loading...</p>
          ) : selectedRunId && selectedRunExecution ? (
            <JsonViewer data={selectedRunExecution.result ?? selectedRunExecution} defaultMode="tree" />
          ) : selectedRunId ? (
            <p className="text-xs text-text-tertiary animate-pulse">Loading...</p>
          ) : (
            <p className="text-xs text-text-tertiary italic">No runs yet</p>
          )}
          {selectedRunExecution?.duration_ms != null && (
            <p className="text-2xs text-text-tertiary mt-2">{(selectedRunExecution.duration_ms / 1000).toFixed(1)}s</p>
          )}
        </div>
      </div>
    </>
  );
}
