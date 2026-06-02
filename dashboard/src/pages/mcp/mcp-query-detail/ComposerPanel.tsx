import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Lightbulb, Layers, Wand2, GitBranch } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { useSubmitMcpQuery, useSubmitMcpQueryRouted } from '../../../api/mcp-query';
import { useSubmitBuildWorkflow } from '../../../api/workflow-builder';
import { useCreateWorkflowSet } from '../../../api/workflow-sets';

type DesignMode = 'discover' | 'direct' | 'plan';

const DISCOVER_STEPS = [
  { icon: MessageSquare, color: 'text-accent', title: 'Describe', detail: 'Write a prompt. The LLM executes tools dynamically to fulfill your request.' },
  { icon: Lightbulb, color: 'text-status-warning', title: 'Discover', detail: 'Review the execution trace — which tools were called, what data flowed between them.' },
  { icon: Layers, color: 'text-status-success', title: 'Compile', detail: 'Successful runs compile into deterministic pipelines. No LLM needed at runtime.' },
];

const DIRECT_STEPS = [
  { icon: MessageSquare, color: 'text-accent', title: 'Describe', detail: 'Specify what tools to use, what inputs to accept, and how data should flow between steps.' },
  { icon: Layers, color: 'text-status-warning', title: 'Review', detail: 'The LLM will create the pipeline (DAG) directly from tool schemas. Review the generated pipeline.' },
  { icon: Wand2, color: 'text-status-success', title: 'Deploy & Test', detail: 'Deploy, run with sample inputs, and refine until the pipeline works correctly.' },
];

const PLAN_STEPS = [
  { icon: MessageSquare, color: 'text-accent', title: 'Specification', detail: 'Describe API endpoints, processes, or paste a spec. The system decomposes it into pipeline tools.' },
  { icon: GitBranch, color: 'text-status-warning', title: 'Plan & Build', detail: 'Review the decomposition, configure the toolset, then build each tool leaf-first.' },
  { icon: Layers, color: 'text-status-success', title: 'Deploy & Test', detail: 'Deploy the toolset. Test individual tools and the full composition.' },
];

export function ComposerPanel() {
  const navigate = useNavigate();
  const [promptText, setPromptText] = useState('');
  const [mode, setMode] = useState<DesignMode>('discover');
  const [forceDiscovery, setForceDiscovery] = useState(true);
  const submitDirect = useSubmitMcpQuery();
  const submitRouted = useSubmitMcpQueryRouted();
  const submitBuilder = useSubmitBuildWorkflow();
  const createSet = useCreateWorkflowSet();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = promptText.trim();
    if (!prompt) return;

    if (mode === 'plan') {
      const name = `plan-${Date.now().toString(36)}`;
      const result = await createSet.mutateAsync({ name, specification: prompt });
      setPromptText('');
      navigate(`/mcp/queries/${result.planner_workflow_id}?mode=plan&set_id=${result.id}`, { replace: true });
    } else if (mode === 'direct') {
      const result = await submitBuilder.mutateAsync({ prompt });
      setPromptText('');
      navigate(`/mcp/queries/${result.workflow_id}?mode=builder`, { replace: true });
    } else {
      const mutation = forceDiscovery ? submitDirect : submitRouted;
      const result = await mutation.mutateAsync({ prompt });
      setPromptText('');
      if (forceDiscovery) {
        navigate(`/mcp/queries/${result.workflow_id}?step=2`, { replace: true });
      } else {
        navigate(`/workflows/executions/${result.workflow_id}`, { replace: true });
      }
    }
  };

  const activeMutation = mode === 'plan' ? createSet
    : mode === 'direct' ? submitBuilder
    : forceDiscovery ? submitDirect : submitRouted;
  const lifecycleSteps = mode === 'plan' ? PLAN_STEPS
    : mode === 'discover' ? DISCOVER_STEPS : DIRECT_STEPS;

  return (
    <div>
      <PageHeader title="Designer" docsHash="#docs:dashboard.md:mcp-tool-designer" />
      <p className="text-sm text-text-secondary mb-6 leading-relaxed max-w-xl">
        Create deterministic MCP tools from natural language. Choose how to get there.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-1 mb-6 p-0.5 bg-surface-sunken rounded-lg w-fit">
        <button
          onClick={() => setMode('discover')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'discover'
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <Wand2 className="w-3 h-3" strokeWidth={1.5} />
          Discover & Compile
        </button>
        <button
          onClick={() => setMode('plan')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'plan'
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <GitBranch className="w-3 h-3" strokeWidth={1.5} />
          Build
        </button>
      </div>

      <div className="grid grid-cols-[1fr_240px] gap-6">
        <form onSubmit={handleSubmit}>
          <div className="rounded-lg border border-surface-border bg-surface-raised overflow-hidden h-full flex flex-col">
            <div className="flex items-start gap-3 flex-1">
              <MessageSquare className="w-4 h-4 text-accent shrink-0 mt-3.5 ml-4" strokeWidth={1.5} />
              <textarea
                ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = Math.min(400, Math.max(160, el.scrollHeight)) + 'px'; } }}
                value={promptText}
                onChange={(e) => {
                  setPromptText(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = Math.min(400, Math.max(160, el.scrollHeight)) + 'px';
                }}
                placeholder={mode === 'plan'
                  ? 'Describe the tools you want to build — API specs, process descriptions, or a full PRD. The system will decompose, build, and deploy them as a composable toolset...'
                  : 'Describe what you want to accomplish. The system will discover and execute the right tools...'
                }
                className="flex-1 min-h-[160px] pr-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none border-none"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e); }}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-t border-surface-border bg-surface-sunken/30">
              {mode === 'plan' ? (
                <span className="text-[10px] text-text-tertiary">
                  Decomposes into composable pipeline tools — builds leaf-first
                </span>
              ) : mode === 'discover' ? (
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={forceDiscovery}
                    onChange={(e) => setForceDiscovery(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-border text-accent-primary focus:ring-accent-primary/50 bg-surface-sunken cursor-pointer"
                  />
                  <span className="text-[10px] text-text-secondary group-hover:text-text-primary transition-colors">Force discovery</span>
                  <span className="text-[10px] text-text-tertiary">{forceDiscovery ? '— skip compiled pipelines' : '— prefer compiled pipelines'}</span>
                </label>
              ) : (
                <span className="text-[10px] text-text-tertiary">
                  LLM builds pipeline from tool schemas — no execution needed
                </span>
              )}
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-text-tertiary">Cmd+Enter</span>
                <button
                  type="submit"
                  disabled={!promptText.trim() || activeMutation.isPending}
                  className="px-4 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {activeMutation.isPending ? 'Starting...' : mode === 'plan' ? 'Plan' : mode === 'discover' ? 'Discover' : 'Build'}
                </button>
              </div>
            </div>
          </div>
          {activeMutation.isError && (
            <p className="mt-2 text-sm text-status-error">{activeMutation.error.message}</p>
          )}
        </form>

        <div className="space-y-4 pt-1">
          {lifecycleSteps.map((step) => (
            <div key={step.title} className="flex items-start gap-2.5">
              <step.icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${step.color}`} strokeWidth={1.5} />
              <div>
                <p className="text-[11px] font-medium text-text-primary">{step.title}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
