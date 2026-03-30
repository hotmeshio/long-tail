import { Link } from 'react-router-dom';
import type { WorkflowExecutionEvent } from '../../../api/types';

interface RouterPhase {
  step: number;        // 0=starting, 1=discover, 2=evaluate, 3=execute
  label: string;
  detail: string;
  path: 'deterministic' | 'dynamic' | null;
  childWorkflowId?: string;
}

const STEPS = ['Discover', 'Evaluate', 'Execute'] as const;

function derivePhase(events: WorkflowExecutionEvent[] | undefined): RouterPhase {
  if (!events?.length) return { step: 0, label: 'Starting...', detail: 'Initializing query router', path: null };

  // Check for child workflow — this reveals the routing decision
  const childStart = events.find((e) => e.event_type === 'child_workflow_execution_started');
  if (childStart) {
    const childId = childStart.attributes.child_workflow_id ?? '';
    const isDeterministic = childId.includes('mcpDeterministic');
    const childCompleted = events.some((e) => e.event_type === 'child_workflow_execution_completed');
    if (childCompleted) {
      return {
        step: 3, label: isDeterministic ? 'Deterministic complete' : 'Dynamic complete',
        detail: isDeterministic ? 'Compiled workflow executed successfully' : 'Dynamic MCP orchestration completed',
        path: isDeterministic ? 'deterministic' : 'dynamic', childWorkflowId: childId,
      };
    }
    return {
      step: 3,
      label: isDeterministic ? 'Running deterministic workflow' : 'Running dynamic MCP query',
      detail: isDeterministic ? 'Executing compiled workflow' : 'LLM agentic orchestration in progress (30\u201360s)',
      path: isDeterministic ? 'deterministic' : 'dynamic',
      childWorkflowId: childId,
    };
  }

  // Derive from activity names
  const activityTypes = events
    .filter((e) => e.category === 'activity')
    .map((e) => e.attributes.activity_type ?? '');

  if (activityTypes.some((a) => a === 'extractWorkflowInputs')) {
    return { step: 2, label: 'Extracting inputs...', detail: 'Preparing structured inputs for compiled workflow', path: null };
  }
  if (activityTypes.some((a) => a === 'evaluateWorkflowMatch')) {
    return { step: 2, label: 'Evaluating match...', detail: 'LLM judge determining best compiled workflow', path: null };
  }
  if (activityTypes.some((a) => a === 'findCompiledWorkflows')) {
    return { step: 1, label: 'Searching compiled workflows...', detail: 'Full-text + tag discovery of candidates', path: null };
  }

  return { step: 0, label: 'Starting...', detail: 'Initializing query router', path: null };
}

interface RouterProgressTrackerProps {
  events: WorkflowExecutionEvent[] | undefined;
  status: string | undefined;
  verifyRunId: string | null;
}

export function RouterProgressTracker({ events, status, verifyRunId }: RouterProgressTrackerProps) {
  const phase = derivePhase(events);
  const isDone = status === 'completed' || status === 'failed';

  return (
    <div className="space-y-4">
      {/* Stepper */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => {
          const stepNum = i + 1;
          const isComplete = phase.step > stepNum || isDone;
          const isActive = phase.step === stepNum && !isDone;
          return (
            <div key={label} className="flex items-center gap-1 flex-1">
              <div className="flex items-center gap-2 flex-1">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium shrink-0 transition-colors ${
                  isComplete ? 'bg-status-success/20 text-status-success' :
                  isActive ? 'bg-accent/20 text-accent animate-pulse' :
                  'bg-surface-sunken text-text-tertiary'
                }`}>
                  {isComplete ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : stepNum}
                </div>
                <span className={`text-[10px] font-medium whitespace-nowrap ${
                  isComplete ? 'text-text-secondary' : isActive ? 'text-text-primary' : 'text-text-tertiary'
                }`}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 min-w-4 ${isComplete ? 'bg-status-success/30' : 'bg-surface-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Detail + badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-text-secondary">{phase.detail}</p>
        {phase.path === 'deterministic' && (
          <span className="text-[10px] bg-status-success/10 text-status-success px-2 py-0.5 rounded-full">
            Deterministic
          </span>
        )}
        {phase.path === 'dynamic' && (
          <span className="text-[10px] bg-status-pending/10 text-status-pending px-2 py-0.5 rounded-full">
            Dynamic
          </span>
        )}
      </div>

      {/* Escape hatch link */}
      {verifyRunId && phase.step >= 1 && (
        <Link
          to={`/workflows/executions/${verifyRunId}`}
          className="text-[10px] text-accent hover:underline"
        >
          View execution tree
        </Link>
      )}
    </div>
  );
}
