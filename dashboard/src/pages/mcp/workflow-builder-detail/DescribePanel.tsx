import { useState, useEffect } from 'react';
import { MessageSquare, HelpCircle, Loader2, CheckCircle, Server, Cpu, FileCode } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { useMcpQueryExecution } from '../../../api/mcp-query';
import { useSubmitBuildWorkflow } from '../../../api/workflow-builder';

interface DescribePanelProps {
  workflowId: string;
  status: string;
  builderData: any;
  onBuilt: () => void;
  onNext: () => void;
}

const BUILD_PHASES = [
  { icon: Server, label: 'Discovering MCP servers and tools', key: 'discover' },
  { icon: Cpu, label: 'LLM constructing YAML pipeline', key: 'build' },
  { icon: FileCode, label: 'Validating workflow structure', key: 'validate' },
];

export function DescribePanel({ workflowId, status, builderData, onBuilt, onNext }: DescribePanelProps) {
  const [answers, setAnswers] = useState('');
  const [activePhase, setActivePhase] = useState(0);
  const submitBuild = useSubmitBuildWorkflow();

  // Always fetch execution — needed for prompt extraction even when complete
  const { data: execution } = useMcpQueryExecution(workflowId);

  const isClarification = builderData?.clarification_needed;
  const questions: string[] = builderData?.questions || [];
  const toolsIdentified: string[] = builderData?.tools_identified || [];
  const isBuilding = status === 'in_progress';
  const isComplete = status === 'completed' && builderData?.yaml;
  const isFailed = status === 'failed' || (builderData?.title?.includes('Failed'));

  // Extract original prompt from the workflow_execution_started event's input envelope
  const startEvent = execution?.events?.find(
    (e: any) => e.event_type === 'workflow_execution_started',
  );
  const envelope = Array.isArray(startEvent?.attributes?.input)
    ? startEvent.attributes.input[0]
    : startEvent?.attributes?.input;
  const originalPrompt: string | null = envelope?.data?.prompt || envelope?.data?.question || null;

  // Animate build phases based on completed activities
  useEffect(() => {
    if (!isBuilding) return;
    const events = execution?.events || [];
    const activityCount = events.filter((e: any) => e.event_type === 'activity_task_completed' && !e.is_system).length;
    if (activityCount >= 2) setActivePhase(2);
    else if (activityCount >= 1) setActivePhase(1);
    else setActivePhase(0);
  }, [isBuilding, execution?.events]);

  const handleAnswer = async () => {
    if (!answers.trim()) return;
    await submitBuild.mutateAsync({
      prompt: builderData?._originalPrompt || workflowId,
      answers: answers.trim(),
      prior_questions: questions,
    });
    onBuilt();
  };

  // Two-column layout mirroring the composer: prompt on left, progress on right
  return (
    <div>
      <h2 className="text-2xl font-extralight tracking-wide text-accent/75 mb-1">Describe</h2>
      <p className="text-base text-text-secondary mb-6">
        {isClarification
          ? 'The builder identified tools but needs more details before constructing the workflow.'
          : isBuilding
          ? 'Building your workflow — this typically takes 20-40 seconds.'
          : isComplete
          ? 'Pipeline constructed — YAML definition, input schema, and activity manifest generated.'
          : isFailed
          ? 'Build failed. Try a more specific prompt or use Discover & Compile mode.'
          : 'Workflow build submitted.'}
      </p>

      {/* Clarification Q&A — full width, different layout */}
      {isClarification && (
        <div className="space-y-4">
          {toolsIdentified.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Tools Identified</p>
              <div className="flex flex-wrap gap-1.5">
                {toolsIdentified.map((t) => (
                  <span key={t} className="px-2 py-0.5 text-xs font-mono bg-accent/10 text-accent rounded">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Questions</p>
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                  <HelpCircle className="w-3.5 h-3.5 text-status-warning shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>{q}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Your Answers</p>
            <textarea
              value={answers}
              onChange={(e) => setAnswers(e.target.value)}
              placeholder="Answer each question above..."
              className="w-full min-h-[120px] px-3 py-2 bg-surface text-sm text-text-primary placeholder:text-text-tertiary rounded-md border border-surface-border resize-none focus:outline-none focus:ring-1 focus:ring-accent"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAnswer(); }}
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={handleAnswer}
                disabled={!answers.trim() || submitBuild.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitBuild.isPending ? 'Submitting...' : 'Submit Answers & Build'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main two-column layout: prompt left, progress right */}
      {!isClarification && (
        <div className="grid grid-cols-[1fr_240px] gap-6">
          {/* Left: original prompt */}
          <div className="rounded-lg bg-surface-sunken/40 overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              <MessageSquare className="w-4 h-4 text-accent shrink-0 mt-0.5" strokeWidth={1.5} />
              {originalPrompt ? (
                <p className="text-sm font-mono text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {originalPrompt}
                </p>
              ) : (
                <p className="text-xs text-text-tertiary italic">Loading prompt...</p>
              )}
            </div>
          </div>

          {/* Right: build progress / completion status */}
          <div className="space-y-3 pt-1">
            {BUILD_PHASES.map((phase, i) => {
              const isDone = isComplete || i < activePhase;
              const isActive = isBuilding && i === activePhase;
              return (
                <div key={phase.key} className="flex items-start gap-2.5">
                  {isDone ? (
                    <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0 mt-0.5" strokeWidth={1.5} />
                  ) : isActive ? (
                    <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0 mt-0.5" strokeWidth={1.5} />
                  ) : (
                    <phase.icon className="w-3.5 h-3.5 text-text-tertiary/40 shrink-0 mt-0.5" strokeWidth={1.5} />
                  )}
                  <div>
                    <p className={`text-[11px] font-medium ${isDone ? 'text-text-primary' : isActive ? 'text-text-primary' : 'text-text-tertiary/50'}`}>
                      {phase.label}
                    </p>
                    {isDone && !isBuilding && (
                      <p className="text-[10px] text-status-success mt-0.5">complete</p>
                    )}
                  </div>
                </div>
              );
            })}

            {isBuilding && (
              <p className="text-[10px] text-text-tertiary pl-6">
                Elapsed: {execution?.duration_ms ? `${(execution.duration_ms / 1000).toFixed(0)}s` : '...'}
              </p>
            )}

            {isComplete && builderData.build_attempts > 1 && (
              <p className="text-[10px] text-text-tertiary pl-6">
                Built in {builderData.build_attempts} attempts
              </p>
            )}

            {isFailed && (
              <p className="text-[10px] text-status-error pl-6">
                {builderData?.summary || 'Build failed'}
              </p>
            )}
          </div>
        </div>
      )}

      <WizardNav>
        <div />
        {isComplete && (
          <button onClick={onNext} className="btn-primary text-xs">
            Next: Profile
          </button>
        )}
      </WizardNav>
    </div>
  );
}
