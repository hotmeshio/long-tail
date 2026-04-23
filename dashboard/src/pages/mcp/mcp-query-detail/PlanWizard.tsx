import { useMemo, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, GitBranch } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { useWorkflowSet } from '../../../api/workflow-sets';
import { useYamlWorkflows } from '../../../api/yaml-workflows';
import { useBuilderResult } from '../../../api/workflow-builder';
import { useMcpQueryDetailEvents } from '../../../hooks/useEventHooks';
import { PlanSidebar } from './PlanSidebar';
import { PlanProfilePanel } from './PlanProfilePanel';
import { DeployPanel } from './DeployPanel';
import { TestPanel } from './TestPanel';
import type { WorkflowSetStatus } from '../../../api/types';

// ── Constants ─────────────────────────────────────────────────────────────────

type PlanStep = 1 | 2 | 3 | 4;
const STEP_LABELS = ['Plan', 'Profile', 'Deploy', 'Test'];

function badgeStatus(status: WorkflowSetStatus): string {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'planning' || status === 'building' || status === 'deploying') return 'in_progress';
  return 'pending';
}

function roleLabel(role: string): string {
  switch (role) {
    case 'leaf': return 'Leaf';
    case 'composition': return 'Composition';
    case 'router': return 'Router';
    default: return role;
  }
}

// ── PlanWizard ────────────────────────────────────────────────────────────────

export function PlanWizard() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  useMcpQueryDetailEvents(workflowId);

  // ── Resolve set_id (URL param first, planner result fallback) ───────────
  const urlSetId = searchParams.get('set_id') || undefined;
  const { data: plannerResult } = useBuilderResult(workflowId);
  const plannerData = plannerResult?.result?.data as Record<string, unknown> | undefined;
  const setId = urlSetId || (plannerData?.set_id as string | undefined);

  // ── Fetch set + yaml workflows ──────────────────────────────────────────
  const { data: workflowSet } = useWorkflowSet(setId);
  const plan = workflowSet?.plan || [];
  const namespaces = workflowSet?.namespaces || [];
  const setStatus: WorkflowSetStatus = (workflowSet?.status as WorkflowSetStatus) || 'planning';

  const yamlFilters = useMemo(() => setId ? { set_id: setId, limit: 50 } : {}, [setId]);
  const { data: yamlData } = useYamlWorkflows(yamlFilters);
  const yamlWorkflows = yamlData?.workflows || [];

  // Refetch yaml list when set status changes
  const prevStatus = useRef(setStatus);
  useEffect(() => {
    if (prevStatus.current !== setStatus) {
      prevStatus.current = setStatus;
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'] });
    }
  }, [setStatus, queryClient]);

  // ── Plan-item → YAML workflow mapping (by build_order) ──────────────────
  const yamlByPlanName = useMemo(() => {
    const map: Record<string, (typeof yamlWorkflows)[number]> = {};
    for (const item of plan) {
      const match = yamlWorkflows.find(w => w.set_build_order === item.build_order);
      if (match) map[item.name] = match;
    }
    return map;
  }, [plan, yamlWorkflows]);

  const yamlStatuses = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, wf] of Object.entries(yamlByPlanName)) {
      map[name] = wf.status;
    }
    return map;
  }, [yamlByPlanName]);

  // ── Namespace lock (first saved non-default app_id wins) ────────────────
  const lockedAppId = useMemo(() => {
    const saved = yamlWorkflows.find(w => w.app_id && w.app_id !== 'longtail');
    return saved?.app_id || null;
  }, [yamlWorkflows]);

  // ── Profile saved tracking ──────────────────────────────────────────────
  // A workflow is "profiled" if its app_id matches the locked namespace
  // (meaning the user explicitly saved it with a chosen server name)
  const profiledSet = useMemo(() => {
    const set = new Set<string>();
    if (!lockedAppId) return set;
    for (const [planName, wf] of Object.entries(yamlByPlanName)) {
      if (wf.app_id === lockedAppId) set.add(planName);
    }
    return set;
  }, [yamlByPlanName, lockedAppId]);

  const hasProfiled = profiledSet.size > 0;

  // ── URL-driven state ────────────────────────────────────────────────────
  const selectedWorkflow = searchParams.get('workflow') || null;
  const selectedYamlId = selectedWorkflow ? yamlByPlanName[selectedWorkflow]?.id || null : null;
  const selectedPlanItem = plan.find(p => p.name === selectedWorkflow) || null;

  const isPlanning = setStatus === 'planning';
  const isFailed = setStatus === 'failed';
  const hasYaml = yamlWorkflows.length > 0;
  const hasActive = yamlWorkflows.some(w => w.status === 'active');

  let maxReachable: PlanStep = 1;
  if (plan.length > 0 && hasYaml) maxReachable = 2;
  if (hasProfiled) maxReachable = 3;
  if (hasActive) maxReachable = 4;

  const stepParam = Number(searchParams.get('step')) || 0;
  const step: PlanStep = (stepParam >= 1 && stepParam <= 4 ? Math.min(stepParam, maxReachable) : 1) as PlanStep;

  const builtCount = yamlWorkflows.length;
  const totalCount = plan.length;
  const activeCount = yamlWorkflows.filter(w => w.status === 'active').length;

  // ── URL sync helpers ────────────────────────────────────────────────────
  const updateUrl = (overrides: Record<string, string | undefined>) => {
    const params: Record<string, string> = { mode: 'plan' };
    if (setId) params.set_id = setId;
    params.step = overrides.step ?? String(step);
    if (overrides.workflow !== undefined) {
      if (overrides.workflow) params.workflow = overrides.workflow;
    } else if (selectedWorkflow) {
      params.workflow = selectedWorkflow;
    }
    setSearchParams(params);
  };

  const handleStepClick = (s: number) => {
    if (s > maxReachable) return;
    const firstWf = plan[0]?.name;
    if (s >= 2 && !selectedWorkflow && firstWf) {
      updateUrl({ step: String(s), workflow: firstWf });
    } else {
      updateUrl({ step: String(s) });
    }
  };

  const handleSelectWorkflow = (name: string) => {
    updateUrl({ workflow: name });
  };

  const handleProfileSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'] });
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflow'] });
  };

  const handleNavigateDeploy = () => {
    updateUrl({ step: '3' });
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-[calc(100vh-12rem)]">
      <PageHeader
        title="MCP Tool Designer"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">Plan</span>
            {totalCount > 0 && (
              <span className="text-[10px] text-text-tertiary">
                {builtCount}/{totalCount} built
                {activeCount > 0 && ` | ${activeCount} deployed`}
              </span>
            )}
            <StatusBadge status={badgeStatus(setStatus)} />
          </div>
        }
      />

      <WizardSteps labels={STEP_LABELS} current={step} maxReachable={maxReachable} onStepClick={handleStepClick} />

      <div className="flex-1 mt-4">
        {/* ── Step 1: Plan ──────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Original specification */}
            {workflowSet?.specification && (
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Specification</label>
                <div className="rounded-md bg-surface-sunken/50 px-4 py-3">
                  <p className="text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap">
                    {workflowSet.specification}
                  </p>
                </div>
              </div>
            )}

            {/* Planning spinner */}
            {isPlanning && (
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="w-4 h-4 text-accent animate-spin" />
                <span className="text-sm text-text-secondary">Analyzing specification and generating plan...</span>
              </div>
            )}

            {isFailed && (
              <div className="flex items-center gap-3 p-4 rounded-lg border border-status-error/20 bg-status-error/5">
                <AlertCircle className="w-4 h-4 text-status-error" />
                <span className="text-sm text-status-error">Plan generation failed.</span>
              </div>
            )}

            {/* Plan description + workflow list */}
            {plan.length > 0 && (
              <div>
                {workflowSet?.description && (
                  <p className="text-sm text-text-secondary mb-4 leading-relaxed">{workflowSet.description}</p>
                )}
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                  Planned Workflows ({plan.length})
                </label>
                <div className="space-y-2">
                  {plan.map((item) => (
                    <div key={item.name} className="px-3 py-2.5 rounded-md bg-surface-raised/50">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-primary">{item.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-sunken text-text-tertiary">{roleLabel(item.role)}</span>
                      </div>
                      <p className="text-[11px] text-text-secondary mt-1">{item.description}</p>
                      {item.dependencies.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          <GitBranch className="w-2.5 h-2.5 text-text-tertiary" />
                          <span className="text-[10px] text-text-tertiary">{item.dependencies.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isPlanning && !isFailed && plan.length > 0 && (
              <button
                onClick={() => handleStepClick(2)}
                className="px-4 py-2 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/90 transition-colors"
              >
                Continue to Profile
              </button>
            )}
          </div>
        )}

        {/* ── Steps 2-4: Sidebar + Main ────────────────────────────────── */}
        {step >= 2 && (
          <div className="flex gap-6">
            <PlanSidebar
              plan={plan}
              namespaces={namespaces}
              yamlStatuses={yamlStatuses}
              activeWorkflow={selectedWorkflow}
              onSelect={handleSelectWorkflow}
            />
            <div className="flex-1 min-w-0">
              {!selectedWorkflow ? (
                <p className="text-sm text-text-tertiary py-12 text-center">Select a workflow from the sidebar.</p>
              ) : !selectedYamlId ? (
                <div className="flex items-center gap-3 py-12 justify-center">
                  <Loader2 className="w-4 h-4 text-accent animate-spin" />
                  <span className="text-sm text-text-secondary">Building {selectedWorkflow}...</span>
                </div>
              ) : step === 2 && selectedPlanItem ? (
                <PlanProfilePanel
                  yamlId={selectedYamlId}
                  planItem={selectedPlanItem}
                  lockedAppId={lockedAppId}
                  isSaved={profiledSet.has(selectedWorkflow!)}
                  onSaved={handleProfileSaved}
                  onNavigateDeploy={handleNavigateDeploy}
                />
              ) : step === 3 ? (
                <DeployPanel
                  yamlId={selectedYamlId}
                  onAdvance={() => handleStepClick(4)}
                  onBack={() => handleStepClick(2)}
                />
              ) : step === 4 ? (
                <TestPanel
                  yamlId={selectedYamlId}
                  originalWorkflowId={workflowId}
                  originalResult={undefined}
                  originalPrompt={undefined}
                  onBack={() => handleStepClick(3)}
                  onAdvance={() => {}}
                  builderMode
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
