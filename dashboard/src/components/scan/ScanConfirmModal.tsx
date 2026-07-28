import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../common/modal/Modal';
import { apiFetch } from '../../api/client';
import { SCAN_VERBS, type ScanPendingAction } from '../../api/scan-codes';
import { SCAN_PENDING_ACTION_STATE } from '../../hooks/useScanInput';

/**
 * Second phase of a confirmed scan action. The scan located the escalation
 * and navigated here with the pending action in route state; this modal asks
 * the rule's prompt and, on confirm, fires the standard per-id endpoint —
 * the same guarded calls every other surface uses.
 */
export function ScanConfirmModal({ escalationId }: { escalationId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pending = (location.state as Record<string, unknown> | null)
    ?.[SCAN_PENDING_ACTION_STATE] as ScanPendingAction | undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (!pending || pending.escalationId !== escalationId || dismissed) return null;

  const clearState = () => {
    setDismissed(true);
    // Drop the pending action from history so refresh/back never re-prompts.
    navigate(location.pathname, { replace: true, state: null });
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      switch (pending.verb) {
        case SCAN_VERBS.CANCEL:
          await apiFetch(`/escalations/${escalationId}/cancel`, { method: 'POST' });
          break;
        case SCAN_VERBS.CLAIM:
        case SCAN_VERBS.CLAIM_SHOW_DETAIL:
          await apiFetch(`/escalations/${escalationId}/claim`, {
            method: 'POST',
            body: JSON.stringify({ durationMinutes: pending.params?.durationMinutes ?? 30 }),
          });
          break;
        case SCAN_VERBS.RELEASE:
          await apiFetch(`/escalations/${escalationId}/release`, { method: 'POST' });
          break;
        case SCAN_VERBS.RESOLVE:
          await apiFetch(`/escalations/${escalationId}/resolve`, {
            method: 'POST',
            body: JSON.stringify({ resolverPayload: pending.params?.resolverPayload ?? {} }),
          });
          break;
        case SCAN_VERBS.ESCALATE:
          await apiFetch(`/escalations/${escalationId}/escalate`, {
            method: 'PATCH',
            body: JSON.stringify({ targetRole: pending.params?.targetRole }),
          });
          break;
        default:
          throw new Error(`Unsupported confirm verb "${pending.verb}"`);
      }
      queryClient.resetQueries({ queryKey: ['escalations'] });
      queryClient.resetQueries({ queryKey: ['escalationStats'] });
      clearState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={clearState} title="Confirm scan action">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{pending.prompt}</p>
        {error && <p className="text-xs text-status-error">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={clearState} disabled={busy} className="btn-secondary text-xs">
            No, go back
          </button>
          <button onClick={confirm} disabled={busy} className="btn-primary text-xs">
            {busy ? 'Working…' : 'Yes, continue'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
