import { useState, useCallback } from 'react';
import { useNatsSubscription } from './useNats';
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
 * Subscribe to NATS activity events for a specific YAML workflow job.
 * Returns live step progress as events arrive.
 */
export function useYamlActivityEvents(jobId: string | null): {
  steps: ActivityStep[];
  isComplete: boolean;
  isFailed: boolean;
} {
  const [steps, setSteps] = useState<ActivityStep[]>([]);

  const handler = useCallback((event: any) => {
    if (!jobId || event.workflowId !== jobId) return;
    const category = event.type?.split('.')[0];
    if (category !== 'activity') return;

    const activityId = event.activityName as string;
    const data = event.data as Record<string, any> | undefined;
    const eventType = event.type as string;

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

  useNatsSubscription(
    jobId ? `${NATS_SUBJECT_PREFIX}.activity.>` : '',
    handler,
  );

  const isComplete = steps.length > 0 && steps.every((s) => s.status === 'completed' || s.status === 'failed');
  const isFailed = steps.some((s) => s.status === 'failed');

  return { steps, isComplete, isFailed };
}
