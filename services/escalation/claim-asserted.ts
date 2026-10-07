import { getPool } from '../../lib/db';
import { escalationEventData } from '../../lib/events/escalation-wire';
import { isUuid } from '../../lib/uuid';
import { ensureEscalationCompatView } from './client';
import { publishEscalationChange } from './crud';
import { toEscalationRecord } from './map';
import type { ClaimResult } from './types';

/**
 * Claims one named row, the same claim `claimByMetadata` makes on the row it
 * picks: pending, the facet still matches, the role is allowed, and no live
 * claim by someone else. One statement; a miss writes nothing.
 * $1=filter $2=assignee $3=minutes $4=roles $5=metadata patch $6=id
 */
export const CLAIM_ASSERTED = `\
WITH target AS MATERIALIZED (
  SELECT id, assigned_to AS prior_assigned_to FROM public.hmsh_escalations
  WHERE id = $6
    AND metadata @> $1::jsonb
    AND ($4::text[] IS NULL OR role = ANY($4::text[]))
    AND status = 'pending'
    AND (assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW() OR assigned_to = $2)
  FOR UPDATE SKIP LOCKED
)
UPDATE public.hmsh_escalations e
SET assigned_to      = $2,
    claimed_at       = NOW(),
    claim_expires_at = NOW() + ($3 * INTERVAL '1 minute'),
    assigned_until   = NOW() + ($3 * INTERVAL '1 minute'),
    metadata         = CASE WHEN $5::jsonb IS NOT NULL
                            THEN COALESCE(e.metadata, '{}'::jsonb) || $5::jsonb
                            ELSE e.metadata END,
    updated_at       = NOW()
FROM target WHERE e.id = target.id
RETURNING e.*, target.prior_assigned_to
`;

/** Claim the row `id` when it still carries `key = value`; null when it does not. */
export async function claimAssertedByMetadata(
  id: string,
  key: string,
  value: string,
  userId: string,
  durationMinutes = 30,
  metadata?: Record<string, any>,
  allowedRoles?: string[] | null,
): Promise<ClaimResult | null> {
  if (!isUuid(id)) return null;
  await ensureEscalationCompatView();
  const { rows } = await getPool().query(CLAIM_ASSERTED, [
    JSON.stringify({ [key]: value }), userId, durationMinutes,
    allowedRoles ?? null, metadata ? JSON.stringify(metadata) : null, id,
  ]);
  if (rows.length === 0) return null;
  const { prior_assigned_to: prior, ...entry } = rows[0];
  const escalation = toEscalationRecord(entry);
  publishEscalationChange({
    type: 'escalation.claimed',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    role: escalation.role,
    status: 'claimed',
    data: escalationEventData(escalation),
  });
  return { escalation, isExtension: prior === userId };
}
