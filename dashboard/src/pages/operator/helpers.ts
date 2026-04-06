import type { UseMutationResult } from '@tanstack/react-query';

/**
 * Create a bulk-action handler that calls a mutation and clears selection on success.
 */
function bulkHandler<TData, TVariables>(
  mutation: UseMutationResult<TData, Error, TVariables>,
  clearSelection: () => void,
  afterSuccess?: () => void,
) {
  return (variables: TVariables) => {
    mutation.mutate(variables, {
      onSuccess: () => {
        clearSelection();
        afterSuccess?.();
      },
    });
  };
}

export function createBulkHandlers(deps: {
  selectedIds: Set<string>;
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
      deps.clearSelection,
    )({ ids: ids(), priority });
  };

  const handleBulkClaim = (durationMinutes: number) => {
    bulkHandler(
      deps.bulkClaim,
      deps.clearSelection,
    )({ ids: ids(), durationMinutes });
  };

  const handleBulkEscalate = (targetRole: string) => {
    bulkHandler(
      deps.bulkEscalate,
      deps.clearSelection,
    )({ ids: ids(), targetRole });
  };

  const handleBulkTriage = (hint?: string) => {
    bulkHandler(
      deps.bulkTriage,
      deps.clearSelection,
      deps.closeTriageModal,
    )({ ids: ids(), hint });
  };

  const handleBulkAssign = (targetUserId: string, durationMinutes: number) => {
    bulkHandler(
      deps.bulkAssign,
      deps.clearSelection,
      deps.closeAssignModal,
    )({ ids: ids(), targetUserId, durationMinutes });
  };

  return { handleSetPriority, handleBulkClaim, handleBulkEscalate, handleBulkTriage, handleBulkAssign };
}
