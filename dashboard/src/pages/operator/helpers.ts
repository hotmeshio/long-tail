import type { UseMutationResult } from '@tanstack/react-query';

type ToastFn = (msg: string, type: 'success' | 'error') => void;

/**
 * Create a bulk-action handler that calls a mutation, shows a toast, and clears selection.
 */
function bulkHandler<TData, TVariables>(
  mutation: UseMutationResult<TData, Error, TVariables>,
  addToast: ToastFn,
  clearSelection: () => void,
  buildMessage: (data: TData) => string,
  afterSuccess?: () => void,
) {
  return (variables: TVariables) => {
    mutation.mutate(variables, {
      onSuccess: (data) => {
        addToast(buildMessage(data), 'success');
        clearSelection();
        afterSuccess?.();
      },
      onError: (err) => addToast(err.message, 'error'),
    });
  };
}

export function createBulkHandlers(deps: {
  selectedIds: Set<string>;
  addToast: ToastFn;
  clearSelection: () => void;
  setPriority: UseMutationResult<{ updated: number }, Error, { ids: string[]; priority: 1 | 2 | 3 | 4 }>;
  bulkClaim: UseMutationResult<{ claimed: number; skipped: number }, Error, { ids: string[]; durationMinutes: number }>;
  bulkEscalate: UseMutationResult<{ updated: number }, Error, { ids: string[]; targetRole: string }>;
  bulkTriage: UseMutationResult<{ triaged: number }, Error, { ids: string[]; hint?: string }>;
  bulkAssign: UseMutationResult<{ assigned: number; skipped: number }, Error, { ids: string[]; targetUserId: string; durationMinutes: number }>;
  closeTriageModal: () => void;
  closeAssignModal: () => void;
}) {
  const ids = () => [...deps.selectedIds];

  const handleSetPriority = (priority: 1 | 2 | 3 | 4) => {
    bulkHandler(
      deps.setPriority,
      deps.addToast,
      deps.clearSelection,
      (data) => `Priority updated for ${data.updated} escalation(s)`,
    )({ ids: ids(), priority });
  };

  const handleBulkClaim = (durationMinutes: number) => {
    bulkHandler(
      deps.bulkClaim,
      deps.addToast,
      deps.clearSelection,
      (data) =>
        data.skipped
          ? `Claimed ${data.claimed} escalation(s), ${data.skipped} skipped`
          : `Claimed ${data.claimed} escalation(s)`,
    )({ ids: ids(), durationMinutes });
  };

  const handleBulkEscalate = (targetRole: string) => {
    bulkHandler(
      deps.bulkEscalate,
      deps.addToast,
      deps.clearSelection,
      (data) => `Escalated ${data.updated} escalation(s) to ${targetRole}`,
    )({ ids: ids(), targetRole });
  };

  const handleBulkTriage = (hint?: string) => {
    bulkHandler(
      deps.bulkTriage,
      deps.addToast,
      deps.clearSelection,
      (data) => `Submitted ${data.triaged} escalation(s) for triage`,
      deps.closeTriageModal,
    )({ ids: ids(), hint });
  };

  const handleBulkAssign = (targetUserId: string, durationMinutes: number) => {
    bulkHandler(
      deps.bulkAssign,
      deps.addToast,
      deps.clearSelection,
      (data) =>
        data.skipped
          ? `Assigned ${data.assigned} escalation(s), ${data.skipped} skipped`
          : `Assigned ${data.assigned} escalation(s)`,
      deps.closeAssignModal,
    )({ ids: ids(), targetUserId, durationMinutes });
  };

  return { handleSetPriority, handleBulkClaim, handleBulkEscalate, handleBulkTriage, handleBulkAssign };
}
