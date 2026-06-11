import { useState, useCallback } from 'react';
import { useEventSubscription } from './useEventContext';
import { NATS_SUBJECT_PREFIX } from '../lib/nats/config';

export interface ActivityStep {
  activityId: string;
  title: string;
  toolName?: string;
  toolSource?: string;
  stepIndex: number;
  totalSteps: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

/**
 * Subscribe to activity and workflow lifecycle events for a specific graph job.
 * Returns live step progress and overall workflow status.
 *
 * Hook-only flows (no worker activities) produce no activity events, so
 * isComplete/isFailed is derived from workflow.completed/failed events instead.
 */
export function useYamlActivityEvents(jobId: string | null): {
  steps: ActivityStep[];
  isComplete: boolean;
  isFailed: boolean;
} {
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [workflowStatus, setWorkflowStatus] = useState<'idle' | 'completed' | 'failed'>('idle');

  const activityHandler = useCallback((event: any) => {
    if (!jobId || event.workflowId !== jobId) return;
    // event.type is the full topic: 'system.activity.{wfId}.{name}.{action}'
    const parts = (event.type as string | undefined)?.split('.') ?? [];
    if (parts[1] !== 'activity') return;

    const activityId = event.activityName as string;
    const data = event.data as Record<string, any> | undefined;
    // Normalise to short form for comparisons below (e.g. 'activity.started')
    const eventType = `activity.${parts[parts.length - 1]}`;

    setSteps((prev) => {
      const existing = prev.find((s) => s.activityId === activityId);

      if (eventType === 'activity.started') {
        if (existing) {
          return prev.map((s) => s.activityId === activityId ? { ...s, status: 'running' as const } : s);
        }
        return [...prev, {
          activityId,
          title: data?.title || activityId,
          toolName: data?.toolName,
          toolSource: data?.toolSource,
          stepIndex: data?.stepIndex ?? prev.length,
          totalSteps: data?.totalSteps ?? 0,
          status: 'running' as const,
        }];
      }

      if (eventType === 'activity.completed' && existing) {
        return prev.map((s) => s.activityId === activityId ? { ...s, status: 'completed' as const } : s);
      }

      if (eventType === 'activity.failed' && existing) {
        return prev.map((s) => s.activityId === activityId ? { ...s, status: 'failed' as const, error: data?.error } : s);
      }

      return prev;
    });
  }, [jobId]);

  const workflowHandler = useCallback((event: any) => {
    if (!jobId || event.workflowId !== jobId) return;
    // event.type is the full topic: 'system.workflow.{wfId}.{action}'
    const action = (event.type as string | undefined)?.split('.').pop();
    if (action === 'completed') setWorkflowStatus('completed');
    if (action === 'failed') setWorkflowStatus('failed');
  }, [jobId]);

  useEventSubscription(
    jobId ? `${NATS_SUBJECT_PREFIX}.system.activity.>` : '',
    activityHandler,
  );
  useEventSubscription(
    jobId ? `${NATS_SUBJECT_PREFIX}.system.workflow.>` : '',
    workflowHandler,
  );

  const stepsComplete = steps.length > 0 && steps.every((s) => s.status === 'completed' || s.status === 'failed');
  const stepsFailed = steps.some((s) => s.status === 'failed');

  const isComplete = stepsComplete || workflowStatus === 'completed';
  const isFailed = stepsFailed || workflowStatus === 'failed';

  return { steps, isComplete, isFailed };
}
