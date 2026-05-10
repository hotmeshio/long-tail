import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { useWorkflowSet, useAddToWorkflowSet } from '../../../api/workflow-sets';
import { useYamlWorkflows } from '../../../api/yaml-workflows';
import { useBuilderResult } from '../../../api/workflow-builder';
import { useMcpQueryDetailEvents, usePlanDetailEvents } from '../../../hooks/useEventHooks';
import { PlanSidebar } from './PlanSidebar';
import { PlanProfilePanel } from './PlanProfilePanel';
import { DeployPanel } from './DeployPanel';
import { TestPanel } from './TestPanel';
import { PlanStep1 } from './PlanStep1';
import { AddToSetDialog } from './AddToSetDialog';
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

// ── PlanWizard ────────────────────────────────────────────────────────────────

export function PlanWizard() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  useMcpQueryDetailEvents(workflowId);
  usePlanDetailEvents(workflowId);

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

  // ── Plan-item to YAML workflow mapping ──────────────────────────────────
  const yamlByPlanName = useMemo(() => {
    const map: Record<string, (typeof yamlWorkflows)[number]> = {};
    const used = new Set<string>();

    // Pass 1: exact name or graph_topic match
    for (const item of plan) {
      const match = yamlWorkflows.find(w =>
        !used.has(w.id) && (w.name === item.name || w.graph_topic === item.name),
      );
      if (match) { map[item.name] = match; used.add(match.id); }
    }

    // Pass 2: positional match within build_order groups
    if (Object.keys(map).length < plan.length) {
      const remaining = yamlWorkflows
        .filter(w => !used.has(w.id))
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      const byOrder = new Map<number, typeof remaining>();
      for (const w of remaining) {
        const order = w.set_build_order ?? 0;
        if (!byOrder.has(order)) byOrder.set(order, []);
        byOrder.get(order)!.push(w);
      }
      for (const item of plan) {
        if (map[item.name]) continue;
        const group = byOrder.get(item.build_order);
        if (group?.length) {
          const match = group.shift()!;
          map[item.name] = match;
          used.add(match.id);
        }
      }
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
  const hasActive = yamlWorkflows.some(w => w.status === 'active');

  let maxReachable: PlanStep = 1;
  if (plan.length > 0) maxReachable = 2; // Allow step 2 as soon as plan exists (YAML may still be building)
  if (hasProfiled) maxReachable = 3;
  if (hasActive) maxReachable = 4;

  const stepParam = Number(searchParams.get('step')) || 0;
  const step: PlanStep = (stepParam >= 1 && stepParam <= 4 ? Math.min(stepParam, maxReachable) : 1) as PlanStep;

  const builtCount = yamlWorkflows.length;
  const totalCount = plan.length;
  const activeCount = yamlWorkflows.filter(w => w.status === 'active').length;

  // ── Add-to-set dialog state ────────────────────────────────────────────
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addSpec, setAddSpec] = useState('');
  const addMutation = useAddToWorkflowSet();
  const [addSubmitted, setAddSubmitted] = useState(false);

  // Auto-close the expand dialog when set returns to completed after an addition
  const prevSetStatus = useRef(setStatus);
  useEffect(() => {
    if (addSubmitted && prevSetStatus.current !== 'completed' && setStatus === 'completed') {
      setAddSubmitted(false);
      setShowAddDialog(false);
      setAddSpec('');
    }
    prevSetStatus.current = setStatus;
  }, [setStatus, addSubmitted]);

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

  const handleAddSubmit = async () => {
    if (!setId || !addSpec.trim()) return;
    await addMutation.mutateAsync({ id: setId, specification: addSpec.trim() });
    setAddSubmitted(true);
  };

  const handleAddCancel = () => {
    setShowAddDialog(false);
    setAddSpec('');
  };

  const handleAddDismiss = () => {
    setAddSubmitted(false);
    setShowAddDialog(false);
    setAddSpec('');
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
          <PlanStep1
            specification={workflowSet?.specification}
            description={workflowSet?.description}
            plan={plan}
            isPlanning={isPlanning}
            isFailed={isFailed}
            onContinue={() => handleStepClick(2)}
          />
        )}

        {/* ── Steps 2-4: Sidebar + Main ────────────────────────────────── */}
        {step >= 2 && (
          <div className="flex gap-6 max-h-[calc(100vh-220px)]">
            <PlanSidebar
              plan={plan}
              namespaces={namespaces}
              yamlStatuses={yamlStatuses}
              activeWorkflow={selectedWorkflow}
              isAddOpen={showAddDialog}
              onSelect={handleSelectWorkflow}
              onAdd={() => setShowAddDialog(!showAddDialog)}
            />
            <div className="flex-1 min-w-0 overflow-y-auto">
              <AddToSetDialog
                isOpen={showAddDialog}
                addSubmitted={addSubmitted}
                addSpec={addSpec}
                setAddSpec={setAddSpec}
                planCount={plan.length}
                isPending={addMutation.isPending}
                isError={addMutation.isError}
                errorMessage={addMutation.error?.message}
                onSubmit={handleAddSubmit}
                onCancel={handleAddCancel}
                onDismiss={handleAddDismiss}
              />
              {!selectedWorkflow ? (
                <p className="text-sm text-text-tertiary py-12 text-center">Select a pipeline tool from the sidebar.</p>
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
                  key={selectedYamlId}
                  yamlId={selectedYamlId}
                  onAdvance={() => handleStepClick(4)}
                  onBack={() => handleStepClick(2)}
                />
              ) : step === 4 ? (
                <TestPanel
                  key={`test-${selectedYamlId}`}
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
