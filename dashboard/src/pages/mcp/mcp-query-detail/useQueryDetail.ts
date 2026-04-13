import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useWorkflowDetailEvents } from '../../../hooks/useNatsEvents';
import { useWizardStep } from '../../../hooks/useWizardStep';
import { useMcpQueryExecution, useMcpQueryResult, useYamlWorkflowForSource, useDescribeMcpQuery } from '../../../api/mcp-query';
import { useCreateYamlWorkflow, useYamlWorkflowAppIds } from '../../../api/yaml-workflows';
import { useWorkflowExecution } from '../../../api/workflows';
import { useTaskByWorkflowId } from '../../../api/tasks';
import { useEscalationsByWorkflowId, useClaimEscalation, useResolveEscalation } from '../../../api/escalations';

import { mapStatus, extractJsonFromSummary, STEP_LABELS_BASE } from './helpers';
import type { Step } from './helpers';

export function useQueryDetail() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Strip ?prompt= from URL on mount (keep only step)
  const promptFromUrl = useRef(searchParams.get('prompt'));
  useEffect(() => {
    if (searchParams.has('prompt')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('prompt');
        return next;
      }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [compileAppId, setCompileAppId] = useState('longtail');
  const [compileName, setCompileName] = useState('');
  const [compileDescription, setCompileDescription] = useState('');
  const [compileTags, setCompileTags] = useState<string[]>([]);
  const [compileInitialized, setCompileInitialized] = useState(false);
  const [compileFeedback, setCompileFeedback] = useState('');

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

  // Escalation data + triage action hooks
  const { data: escalationData } = useEscalationsByWorkflowId(workflowId);
  const activeEscalation = escalationData?.escalations?.find((e: any) => e.status === 'pending');
  const resolvedEscalation = escalationData?.escalations?.find((e: any) => e.status === 'resolved');
  const displayEscalation = activeEscalation || resolvedEscalation;
  const claimMutation = useClaimEscalation();
  const resolveMutation = useResolveEscalation();

  // Extract triage metadata from resolved escalation
  const resolvedPayload = useMemo(() => {
    if (!resolvedEscalation?.resolver_payload) return null;
    try {
      return typeof resolvedEscalation.resolver_payload === 'string'
        ? JSON.parse(resolvedEscalation.resolver_payload)
        : resolvedEscalation.resolver_payload;
    } catch { return null; }
  }, [resolvedEscalation?.resolver_payload]);
  const triageWorkflowId = resolvedPayload?._lt?.triageWorkflowId as string | undefined;

  // Fetch the triage result to discover the re-run workflow ID
  const { data: triageResultData } = useWorkflowExecution(
    resolvedPayload?._lt?.triaged ? (triageWorkflowId ?? '') : '',
  );
  const triageResult = (triageResultData?.result as any)?.data as Record<string, unknown> | undefined;
  const rerunWorkflowId = triageResult?.rerunWorkflowId as string | undefined;

  // Detect rounds_exhausted from result data OR milestones (covers old + new runs)
  const milestones = (resultData?.result as any)?.milestones as Array<{ name: string; value: string }> | undefined;
  const isRoundsExhausted = !!(result as any)?.rounds_exhausted ||
    !!milestones?.some((m) => m.name === 'rounds_exhausted');

  // This run is uncompilable if it failed — triage resolving doesn't make THIS run compilable
  const isUncompilable = isRoundsExhausted || !!activeEscalation;

  // Extract original prompt: envelope > URL param (captured on mount) > execution events
  const originalPrompt = useMemo(() => {
    const fromEnvelope = (originalEnvelope as any)?.data?.prompt;
    if (fromEnvelope) return fromEnvelope as string;
    if (promptFromUrl.current) return promptFromUrl.current;
    for (const e of events) {
      const attrs = e.attributes as Record<string, unknown>;
      if (attrs.activity_type === 'findCompiledWorkflows' && Array.isArray(attrs.input) && typeof (attrs.input as unknown[])[0] === 'string') {
        return (attrs.input as string[])[0];
      }
    }
    return undefined;
  }, [originalEnvelope, events]);

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
    if (status === 'pending') return 1;
    if (status === 'in_progress') return 2;
    if (!result) return 1;
    if (!compiledYaml) return 2;
    if (compiledYaml.status === 'draft' || compiledYaml.status === 'deployed') return 4;
    return 5;
  }, [status, result, compiledYaml]);

  const [manualStep, setManualStep] = useWizardStep();
  const step = (manualStep as Step | null) ?? autoStep;

  // Sequential unlock: each step requires the prior step to be satisfied
  const maxReachable: Step = (() => {
    if (status === 'pending') return 1;
    if (status === 'in_progress' || !result) return 2;
    if (isUncompilable) return 2;
    if (!compiledYaml) return 3;
    if (compiledYaml.status === 'draft') return 4;
    if (compiledYaml.status === 'deployed') return 5;
    return 6; // active
  })() as Step;

  // Auto-advance from step 2 → step 3 when workflow completes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === 'in_progress' && status === 'completed' && manualStep === null) {
      setManualStep(3);
    }
    prevStatusRef.current = status;
  }, [status, manualStep, setManualStep]);

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
    if (!compileName && describeData.tool_name) setCompileName(describeData.tool_name);
  }

  // Topic always derives from workflow name (not namespace — using namespace causes topic collisions)
  const derivedSubscribes = compileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const allAppIds = useMemo(() => appIdData?.app_ids ?? [], [appIdData?.app_ids]);

  const handleCompile = async () => {
    if (!workflowId || !compileName.trim() || !compileAppId.trim()) return;
    await createYaml.mutateAsync({
      workflow_id: workflowId, task_queue: 'long-tail-system', workflow_name: 'mcpQuery',
      name: compileName.trim(), description: compileDescription.trim() || undefined,
      app_id: compileAppId.trim(), subscribes: derivedSubscribes, tags: compileTags,
      compilation_feedback: compileFeedback.trim() || undefined,
    });
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
    setManualStep(4);
  };

  const handleRetryTriage = async () => {
    if (!activeEscalation) return;
    await claimMutation.mutateAsync({ id: activeEscalation.id, durationMinutes: 30 });
    const diagnosis = (result as any)?.diagnosis as string || activeEscalation.description || '';
    await resolveMutation.mutateAsync({
      id: activeEscalation.id,
      resolverPayload: { _lt: { needsTriage: true }, notes: diagnosis },
    });
  };

  // Determine the correct next step for profile panel navigation
  const profileNextStep = compiledYaml?.status === 'active' ? 5 : 4;

  return {
    workflowId,
    execution,
    status,
    result,
    discovery,
    events,
    originalEnvelope,
    originalPrompt,
    originalOutput,
    originalExecution,
    compiledYaml,
    step,
    maxReachable,
    stepLabels,
    setManualStep,
    compileAppId,
    setCompileAppId,
    compileName,
    setCompileName,
    compileDescription,
    setCompileDescription,
    compileTags,
    setCompileTags,
    compileFeedback,
    setCompileFeedback,
    describeData,
    describePrompt,
    allAppIds,
    handleCompile,
    createYaml,
    isUncompilable,
    isRoundsExhausted,
    displayEscalation,
    activeEscalation,
    handleRetryTriage,
    claimMutation,
    resolveMutation,
    rerunWorkflowId,
    profileNextStep,
  };
}
