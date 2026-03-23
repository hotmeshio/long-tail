import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../../../components/common/layout/PageHeader';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import { SimpleMarkdown } from '../../../components/common/display/SimpleMarkdown';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { SwimlaneTimeline } from '../../workflows/workflow-execution/SwimlaneTimeline';
import { useWorkflowDetailEvents } from '../../../hooks/useNatsEvents';
import { useWizardStep } from '../../../hooks/useWizardStep';
import { useMcpQueryExecution, useMcpQueryResult, useYamlWorkflowForSource, useDescribeMcpQuery } from '../../../api/mcp-query';
import { useCreateYamlWorkflow, useYamlWorkflowAppIds } from '../../../api/yaml-workflows';
import { useWorkflowExecution } from '../../../api/workflows';
import { useTaskByWorkflowId } from '../../../api/tasks';
import { TagInput } from '../../../components/common/form/TagInput';
import { DeployPanel } from './DeployPanel';
import { TestPanel } from './TestPanel';
import { VerifyPanel } from './VerifyPanel';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ResultSummary({ text }: { text: string }) {
  const parts: Array<{ type: 'text' | 'json'; content: string }> = [];
  const jsonBlockRe = /\n?\{[\s\S]*?\n\}/g;
  let lastIndex = 0;
  for (const match of text.matchAll(jsonBlockRe)) {
    try {
      JSON.parse(match[0].trim());
      if (match.index! > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      parts.push({ type: 'json', content: match[0].trim() });
      lastIndex = match.index! + match[0].length;
    } catch { /* not JSON */ }
  }
  if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) });
  if (!parts.length) parts.push({ type: 'text', content: text });
  return (
    <div className="space-y-3">
      {parts.map((p, i) => p.type === 'json'
        ? <JsonViewer key={i} data={JSON.parse(p.content)} defaultMode="tree" />
        : p.content.trim() ? <SimpleMarkdown key={i} content={p.content.trim()} /> : null)}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">{children}</span>
      <span className="flex-1 border-b border-surface-border" />
    </div>
  );
}


function extractJsonFromSummary(summary: string): Record<string, unknown> | null {
  const match = summary.match(/```json\s*([\s\S]*?)```/) || summary.match(/\{[\s\S]*?\n\}/);
  if (!match) return null;
  try { return JSON.parse((match[1] ?? match[0]).trim()); } catch { return null; }
}

function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-light text-text-primary">{title}</h2>
      {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
    </div>
  );
}

function mapStatus(exec: { status?: string } | undefined): string {
  if (!exec) return 'pending';
  if (exec.status === 'completed') return 'completed';
  if (exec.status === 'failed') return 'failed';
  return 'in_progress';
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const STEP_LABELS_BASE = ['Original', 'Timeline', 'Profile', 'Deploy', 'Test', 'Verify'] as const;

// ── Main component ──────────────────────────────────────────────────────────

export function McpQueryDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [compileAppId, setCompileAppId] = useState('longtail');
  const [compileName, setCompileName] = useState('');
  const [compileSubscribes, setCompileSubscribes] = useState('');
  const [autoSubscribes, setAutoSubscribes] = useState(true);
  const [compileDescription, setCompileDescription] = useState('');
  const [compileTags, setCompileTags] = useState<string[]>([]);
  const [compileInitialized, setCompileInitialized] = useState(false);

  const { data: execution } = useMcpQueryExecution(workflowId);
  const { data: resultData } = useMcpQueryResult(workflowId);
  const { data: yamlSearch } = useYamlWorkflowForSource(workflowId);
  useWorkflowDetailEvents(workflowId);

  const createYaml = useCreateYamlWorkflow();
  const { data: appIdData } = useYamlWorkflowAppIds();

  // Original execution + task envelope (for Panel 1 and prompt extraction)
  const { data: originalExecution } = useWorkflowExecution(workflowId ?? '');
  const { data: originalTask } = useTaskByWorkflowId(workflowId ?? '');
  const originalEnvelope = useMemo(() => {
    if (!originalTask?.envelope) return null;
    try { return typeof originalTask.envelope === 'string' ? JSON.parse(originalTask.envelope) : originalTask.envelope; }
    catch { return null; }
  }, [originalTask?.envelope]);
  const originalExecResult = (originalExecution?.result as any)?.data as Record<string, unknown> | undefined;

  const status = mapStatus(execution);
  const result = resultData?.result?.data as Record<string, unknown> | undefined;
  const discovery = (result?.discovery as Record<string, unknown>) || {};
  const events = execution?.events ?? [];

  // Extract original prompt: envelope > URL param > execution events
  const originalPrompt = useMemo(() => {
    const fromEnvelope = (originalEnvelope as any)?.data?.prompt;
    if (fromEnvelope) return fromEnvelope as string;
    const fromUrl = searchParams.get('prompt');
    if (fromUrl) return fromUrl;
    for (const e of events) {
      const attrs = e.attributes as Record<string, unknown>;
      if (attrs.activity_type === 'findCompiledWorkflows' && Array.isArray(attrs.input) && typeof (attrs.input as unknown[])[0] === 'string') {
        return (attrs.input as string[])[0];
      }
    }
    return undefined;
  }, [originalEnvelope, searchParams, events]);

  // Extract structured output from original execution
  const originalOutput = useMemo(() => {
    return originalExecResult?.result ??
      (typeof originalExecResult?.summary === 'string' ? extractJsonFromSummary(originalExecResult.summary) : null) ??
      result?.result ??
      (typeof result?.summary === 'string' ? extractJsonFromSummary(result.summary as string) : null) ??
      null;
  }, [originalExecResult, result]);

  const describePrompt = originalPrompt || (result?.title as string | undefined);
  const { data: describeData } = useDescribeMcpQuery({
    prompt: status === 'completed' ? describePrompt : undefined,
    resultTitle: result?.title as string | undefined,
    resultSummary: result?.summary as string | undefined,
  });

  const compiledYaml = yamlSearch?.workflows?.find(
    (w) => w.status === 'active' || w.status === 'deployed' || w.status === 'draft',
  );

  const autoStep: Step = useMemo(() => {
    if (status === 'in_progress' || status === 'pending') return 1;
    if (!result) return 1;
    if (!compiledYaml) return 2;
    if (compiledYaml.status === 'draft' || compiledYaml.status === 'deployed') return 4;
    return 5;
  }, [status, result, compiledYaml]);

  const [manualStep, setManualStep] = useWizardStep();
  const step = (manualStep as Step | null) ?? autoStep;
  const maxReachable: Step = compiledYaml?.status === 'active' ? 6 : autoStep >= 3 ? autoStep : (result ? 3 : autoStep) as Step;

  const stepLabels = useMemo((): string[] => {
    const labels: string[] = [...STEP_LABELS_BASE];
    if (compiledYaml?.status === 'active') labels[3] = 'Redeploy';
    return labels;
  }, [compiledYaml?.status]);

  // Pre-fill compile fields from LLM
  if (describeData && !compileInitialized) {
    setCompileInitialized(true);
    if (!compileDescription) setCompileDescription(describeData.description);
    if (compileTags.length === 0 && describeData.tags.length > 0) setCompileTags(describeData.tags);
  }
  if (result && !compileName) {
    const title = (result.title as string) || '';
    const slug = title.replace(/[—–]/g, '-').replace(/[^a-zA-Z0-9\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
    if (slug) { setCompileName(slug); if (autoSubscribes) setCompileSubscribes(slug); }
  }

  const derivedSubscribes = autoSubscribes ? compileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : compileSubscribes;
  const allAppIds = useMemo(() => appIdData?.app_ids ?? [], [appIdData?.app_ids]);

  const handleCompile = async () => {
    if (!workflowId || !compileName.trim() || !compileAppId.trim()) return;
    await createYaml.mutateAsync({
      workflow_id: workflowId, task_queue: 'long-tail-system', workflow_name: 'mcpQuery',
      name: compileName.trim(), description: compileDescription.trim() || undefined,
      app_id: compileAppId.trim(), subscribes: derivedSubscribes, tags: compileTags,
    });
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
    setManualStep(null);
  };


  return (
    <div className="flex flex-col min-h-[calc(100vh-12rem)]">
      <PageHeader
        title="Deterministic MCP Wizard"
        actions={
          <button onClick={() => navigate('/mcp/queries')} className="text-sm text-text-secondary hover:text-text-primary">
            Back to list
          </button>
        }
      />

      {/* Status card */}
      <div className="bg-surface-raised border border-surface-border rounded-md px-6 py-5 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <StatusBadge status={status} />
          {discovery?.method === 'compiled-workflow' && (
            <span className="text-xs bg-status-success/10 text-status-success px-2 py-0.5 rounded-full">
              Deterministic ({((discovery.confidence as number) * 100).toFixed(0)}% match)
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-8">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Run ID</p>
            <CopyableId label="" value={workflowId ?? null} href={`/workflows/executions/${workflowId}`} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Duration</p>
            <p className="text-xs text-text-primary font-mono">
              {execution?.duration_ms != null ? `${(execution.duration_ms / 1000).toFixed(1)}s` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Started</p>
            <p className="text-xs text-text-primary">
              {execution?.start_time ? <TimeAgo date={execution.start_time} /> : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Tool Calls</p>
            <p className="text-xs text-text-primary">
              {typeof result?.tool_calls_made === 'number' ? result.tool_calls_made : '—'}
            </p>
          </div>
        </div>
      </div>

      <WizardSteps labels={stepLabels} current={step} maxReachable={maxReachable} onStepClick={(s) => setManualStep(s as Step)} />

      {/* Panel content — flex-1 ensures WizardNav sticks to bottom */}
      <div className="flex-1">

      {/* Step 1: Original Query — input/output side by side */}
      {step === 1 && (
        <div>
          <PanelTitle title="Original MCP Query" subtitle="Dynamic LLM-orchestrated execution with MCP tools" />

          {status === 'in_progress' && events.length > 0 && <SwimlaneTimeline events={events} />}
          {status === 'in_progress' && events.length === 0 && <p className="text-sm text-text-secondary animate-pulse">Starting query...</p>}

          {status === 'completed' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left: Input */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input</p>
                {originalEnvelope ? (
                  <JsonViewer data={originalEnvelope} defaultMode="tree" />
                ) : originalPrompt ? (
                  <p className="text-xs text-text-primary leading-relaxed px-3 py-2 bg-surface-sunken rounded-md">{originalPrompt}</p>
                ) : (
                  <p className="text-xs text-text-tertiary italic">Loading...</p>
                )}
              </div>

              {/* Right: Output */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output</p>
                {originalOutput ? (
                  <JsonViewer data={originalOutput} defaultMode="tree" />
                ) : result?.summary ? (
                  <ResultSummary text={result.summary as string} />
                ) : (
                  <p className="text-xs text-text-tertiary italic">No structured output</p>
                )}
                {originalExecution?.duration_ms != null && (
                  <p className="text-[10px] text-text-tertiary mt-2">{(originalExecution.duration_ms / 1000).toFixed(1)}s</p>
                )}
              </div>
            </div>
          )}

          {status === 'completed' && (
            <WizardNav><span /><button onClick={() => setManualStep(2)} className="btn-primary text-xs">Next: Timeline</button></WizardNav>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Step 2: MCP Timeline */}
      {step === 2 && (
        <div>
          <PanelTitle title="MCP Execution Timeline" subtitle="Activity swimlane showing tool calls and their durations" />
          <SwimlaneTimeline events={events} />
          <WizardNav>
            <button onClick={() => setManualStep(1)} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
            <button onClick={() => setManualStep(3)} className="btn-primary text-xs">Next: Profile</button>
          </WizardNav>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Step 3: Compile — config form or readonly summary */}
      {step === 3 && (
        <div>
          {compiledYaml ? (
            <div>
              <PanelTitle title="Deterministic Workflow Profile" subtitle="Configuration and pipeline for the compiled MCP workflow tool" />

              {/* Two-column layout: details left, pipeline+tags right */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-6">
                {/* Left: identity + description */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Name</p>
                      <p className="text-sm font-mono text-text-primary">{compiledYaml.name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Status</p>
                      <StatusBadge status={compiledYaml.status} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Namespace</p>
                      <p className="text-xs font-mono text-text-primary">{(compiledYaml as any).app_id || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Topic</p>
                      <p className="text-xs font-mono text-text-primary">{compiledYaml.graph_topic || '—'}</p>
                    </div>
                  </div>
                  {(compiledYaml as any).description && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Description</p>
                      <p className="text-xs text-text-secondary leading-relaxed">{(compiledYaml as any).description}</p>
                    </div>
                  )}
                </div>

                {/* Right: pipeline + tags */}
                <div className="space-y-4">
                  {(compiledYaml as any).activity_manifest?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Pipeline</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        {((compiledYaml as any).activity_manifest as any[])
                          .filter((a: any) => a.tool_source !== 'trigger')
                          .map((a: any, i: number, arr: any[]) => (
                            <span key={i} className="flex items-center gap-1">
                              <span className="text-[10px] px-2 py-0.5 rounded bg-surface-sunken font-mono text-text-primary">{a.mcp_tool_name || a.title}</span>
                              {i < arr.length - 1 && <span className="text-text-tertiary text-[10px]">→</span>}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                  {(compiledYaml as any).tags?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {((compiledYaml as any).tags as string[]).slice(0, 12).map((tag: string) => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-sunken text-text-secondary">{tag}</span>
                        ))}
                        {((compiledYaml as any).tags as string[]).length > 12 && (
                          <span className="text-[10px] text-text-tertiary">+{((compiledYaml as any).tags as string[]).length - 12} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <WizardNav>
                <button onClick={() => setManualStep(2)} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
                <div className="flex gap-3">
                  <Link to={`/mcp/workflows/${compiledYaml.id}`} className="px-3 py-1.5 text-xs border border-surface-border rounded text-text-primary hover:bg-surface-sunken transition-colors">
                    Edit Workflow
                  </Link>
                  {compiledYaml.status !== 'active'
                    ? <button onClick={() => setManualStep(4)} className="btn-primary text-xs">Next: Deploy</button>
                    : <button onClick={() => setManualStep(5)} className="btn-primary text-xs">Next: Test</button>}
                </div>
              </WizardNav>
            </div>
          ) : (
            <div>
              <PanelTitle title="Create Workflow Profile" subtitle="Define the deterministic workflow tool from this execution" />

              {originalPrompt && (
                <div className="mb-6">
                  <SectionHeading>Original Query</SectionHeading>
                  <p className="text-xs text-text-primary leading-relaxed">{originalPrompt}</p>
                </div>
              )}

              <SectionHeading>Workflow Configuration</SectionHeading>
              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Namespace *</label>
                  <input type="text" value={compileAppId} onChange={(e) => setCompileAppId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                    className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary" placeholder="e.g. longtail" />
                  {allAppIds.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {allAppIds.map((id) => (
                        <button key={id} type="button" onClick={() => setCompileAppId(id)}
                          className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${compileAppId === id ? 'bg-accent/20 text-accent' : 'bg-surface-sunken text-text-tertiary hover:text-text-secondary'}`}>{id}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tool Name *</label>
                  <input type="text" value={compileName} onChange={(e) => setCompileName(e.target.value)}
                    className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary" placeholder="e.g. auth-screenshot-all-nav-pages" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Topic</label>
                  <div className="flex items-center gap-2">
                    <input type="text" value={derivedSubscribes} onChange={(e) => { setAutoSubscribes(false); setCompileSubscribes(e.target.value); }}
                      className="flex-1 bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary" placeholder="auto-derived" />
                    {!autoSubscribes && <button type="button" onClick={() => setAutoSubscribes(true)} className="text-[10px] text-accent hover:underline shrink-0">Auto</button>}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Description</label>
                    {!compileDescription && !describeData && describePrompt && <span className="text-[10px] text-accent animate-pulse">Generating...</span>}
                  </div>
                  <textarea value={compileDescription} onChange={(e) => setCompileDescription(e.target.value)}
                    placeholder="Describe what this workflow does as a reusable tool..."
                    className="w-full min-h-[80px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md text-xs text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary" />
                  <p className="text-[10px] text-text-tertiary mt-1">{describeData ? 'AI-generated. Edit to refine.' : 'Describe what this workflow does so future queries can find it.'}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</label>
                  <TagInput tags={compileTags} onChange={setCompileTags} placeholder="e.g. browser, screenshots, login" />
                  <p className="text-[10px] text-text-tertiary mt-1">Press Enter or comma to add.</p>
                </div>
              </div>

              <WizardNav>
                <button onClick={() => setManualStep(2)} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
                <button onClick={handleCompile} disabled={!compileName.trim() || !compileAppId.trim() || createYaml.isPending} className="btn-primary text-xs">
                  {createYaml.isPending ? 'Creating...' : 'Create Profile'}
                </button>
              </WizardNav>
              {createYaml.isError && <p className="mt-3 text-sm text-status-error">{createYaml.error.message}</p>}
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Step 4: Deploy — full config editor, lifecycle, versions */}
      {step === 4 && compiledYaml && (
        <DeployPanel
          yamlId={compiledYaml.id}
          onAdvance={() => setManualStep(5)}
          onBack={() => setManualStep(3)}
        />
      )}

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Step 5: Test & Compare — grid-aligned inputs/outputs */}
      {step === 5 && compiledYaml && (
        <TestPanel
          yamlId={compiledYaml.id}
          originalWorkflowId={workflowId}
          originalResult={result}
          originalPrompt={originalPrompt}
          onBack={() => setManualStep(4)}
          onAdvance={() => setManualStep(6)}
        />
      )}

      {/* Step 6: Verify — submit original prose, confirm deterministic path fires */}
      {step === 6 && compiledYaml && (
        <VerifyPanel
          originalWorkflowId={workflowId}
          originalPrompt={originalPrompt}
          workflowName={compiledYaml.name}
          onBack={() => setManualStep(5)}
          onGoToDeploy={() => setManualStep(4)}
        />
      )}

      </div>{/* end flex-1 panel content */}
    </div>
  );
}
