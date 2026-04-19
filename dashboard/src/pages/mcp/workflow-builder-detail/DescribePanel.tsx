import { useState } from 'react';
import { MessageSquare, HelpCircle, Loader2 } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { useSubmitBuildWorkflow } from '../../../api/workflow-builder';

interface DescribePanelProps {
  workflowId: string;
  status: string;
  builderData: any;
  onBuilt: () => void;
  onNext: () => void;
}

export function DescribePanel({ workflowId, status, builderData, onBuilt, onNext }: DescribePanelProps) {
  const [answers, setAnswers] = useState('');
  const submitBuild = useSubmitBuildWorkflow();

  const isClarification = builderData?.clarification_needed;
  const questions: string[] = builderData?.questions || [];
  const toolsIdentified: string[] = builderData?.tools_identified || [];
  const isBuilding = status === 'in_progress';
  const isComplete = status === 'completed' && builderData?.yaml;

  const handleAnswer = async () => {
    if (!answers.trim()) return;
    await submitBuild.mutateAsync({
      prompt: builderData?._originalPrompt || workflowId,
      answers: answers.trim(),
      prior_questions: questions,
    });
    onBuilt();
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="w-4 h-4 text-accent" strokeWidth={1.5} />
        <h2 className="text-sm font-semibold text-text-primary">Describe</h2>
      </div>
      <p className="text-xs text-text-tertiary mb-6">
        {isClarification
          ? 'The builder identified tools but needs more details before constructing the workflow.'
          : isBuilding
          ? 'Building your workflow...'
          : isComplete
          ? 'Workflow built successfully. Review the output in the next step.'
          : 'Workflow build submitted.'}
      </p>

      {isBuilding && (
        <div className="flex items-center gap-3 py-12 justify-center text-text-tertiary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Discovering tools and building YAML...</span>
        </div>
      )}

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
              placeholder="Answer each question above. Be specific about tools, inputs, outputs, and any transformations needed..."
              className="w-full min-h-[120px] px-3 py-2 bg-surface text-sm text-text-primary placeholder:text-text-tertiary rounded-md border border-surface-border resize-none focus:outline-none focus:ring-1 focus:ring-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAnswer();
              }}
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

      {isComplete && (
        <div className="py-6 text-center">
          <p className="text-sm text-status-success font-medium mb-1">
            {builderData.title}
          </p>
          <p className="text-xs text-text-tertiary">{builderData.summary}</p>
        </div>
      )}

      <WizardNav>
        <div />
        {isComplete && (
          <button
            onClick={onNext}
            className="px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors"
          >
            Review &rarr;
          </button>
        )}
      </WizardNav>
    </div>
  );
}
