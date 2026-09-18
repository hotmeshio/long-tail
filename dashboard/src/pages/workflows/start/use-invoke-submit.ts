import { useCallback, useState } from 'react';
import { useInvokeWorkflow } from '../../../api/workflows';
import { ApiError } from '../../../api/client';
import { isValidationErrorBody } from '../../../lib/validation';
import { useAccess } from '../../../hooks/useAccess';
import type { FieldError } from '../../../lib/field-validator';
import type { LTWorkflowConfig } from '../../../api/types';

export const EXECUTIONS_PATH = '/workflows/executions';

/** Where an invoke form is hosted: the Invoke Tool page, or a dialog opened from another surface. */
export const INVOKE_HOSTS = {
  PAGE: 'page',
  MODAL: 'modal',
} as const;
export type InvokeHost = (typeof INVOKE_HOSTS)[keyof typeof INVOKE_HOSTS];

/** What a form needs from the submission: the call, its state, and the outcome. */
export interface InvokeSubmission {
  submit: (data: Record<string, unknown>, metadata: Record<string, unknown>) => Promise<void>;
  reset: () => void;
  pending: boolean;
  error: string | null;
  /** Field violations from a 422; the form surfaces them as issues. */
  violations: FieldError[];
  startedId: string | null;
  /** The started run's page, for callers who may open executions. */
  executionPath: string | null;
}

/**
 * One submit path for both invoke forms. Merges the per-run certified flag
 * and identity override, posts the same envelope the API has always taken,
 * and maps a 422 into field violations. Everyone stays on the page and sees
 * the started id; builders also get the link to its execution, a page only
 * they may open.
 */
export function useInvokeSubmit(
  selected: Pick<LTWorkflowConfig, 'workflow_type'>,
  run: { certified: boolean; overrideBot: string },
): InvokeSubmission {
  const { realIsBuilder } = useAccess();
  const mutation = useInvokeWorkflow();
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<FieldError[]>([]);
  const [startedId, setStartedId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setViolations([]);
    setStartedId(null);
    mutation.reset();
  }, [mutation]);

  const submit = useCallback(async (data: Record<string, unknown>, metadata: Record<string, unknown>) => {
    setError(null);
    setViolations([]);
    setStartedId(null);
    const resolvedMetadata: Record<string, unknown> = { ...metadata };
    if (run.certified) resolvedMetadata.certified = true;
    try {
      const result = await mutation.mutateAsync({
        workflowType: selected.workflow_type,
        data,
        metadata: resolvedMetadata,
        ...(run.overrideBot ? { execute_as: run.overrideBot } : {}),
      });
      setStartedId(result.workflowId);
    } catch (err) {
      if (err instanceof ApiError && isValidationErrorBody(err.body)) {
        setViolations(err.body.violations);
        setError(err.body.error);
      } else {
        setError(err instanceof Error ? err.message : 'Invocation failed');
      }
    }
  }, [mutation, run.certified, run.overrideBot, selected.workflow_type]);

  return {
    submit,
    reset,
    pending: mutation.isPending,
    error,
    violations,
    startedId,
    executionPath: startedId && realIsBuilder ? `${EXECUTIONS_PATH}/${encodeURIComponent(startedId)}` : null,
  };
}
