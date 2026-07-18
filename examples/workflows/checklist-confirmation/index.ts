/**
 * Checklist Confirmation Workflow — reference example for the `checklist` widget
 * and runtime-driven escalation forms.
 *
 * The caller supplies `count` (1–20, default 3). The workflow generates that
 * many labelled checklist items and carries them in the escalation envelope —
 * not in metadata, because they are render data, not searchable facets.
 *
 * The dashboard renders a labelled checkbox per item. On resolution, the
 * workflow receives `{ items: Record<string, boolean> }` and summarises the
 * confirmed/unconfirmed breakdown.
 *
 * Invoke via the dashboard (Workflows → checklistConfirmation) with:
 *   { data: { count: 5 }, metadata: { source: 'dashboard' } }
 *
 * Domain guidance:
 *   envelope  — form render data (checklist labels, instructions). Not indexed.
 *   metadata  — searchable facets long-tail GIN-indexes (orderId, station, …).
 *   payload   — structural carry-forward from a prior workflow step.
 *   resolver  — live form edits; reactive via x-lt-showIf: 'resolver.field'.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import {
  CHECKLIST_ROLE,
  CHECKLIST_SCHEMA_VERSION,
  type ChecklistResolverV1,
} from './forms';

type ActivitiesType = typeof activities;

interface ChecklistItem { id: string; label: string }

const MIN_ITEMS = 1;
const MAX_ITEMS = 20;

export async function checklistConfirmation(envelope: LTEnvelope): Promise<any> {
  const count = Math.max(MIN_ITEMS, Math.min(Number(envelope.data.count ?? 3), MAX_ITEMS));

  const { summarizeChecklist } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `checklist-${ctx.workflowId}`;

  const checklistItems: ChecklistItem[] = Array.from({ length: count }, (_, i) => ({
    id: `item_${i}`,
    label: `Step ${i + 1}: Confirm action ${i + 1}`,
  }));

  // Pre-initialise all items to false so the form opens with every box unchecked.
  const initialState: Record<string, boolean> = Object.fromEntries(
    checklistItems.map((item) => [item.id, false]),
  );

  const decision = await conditionLT<ChecklistResolverV1>(signalId, {
    role: CHECKLIST_ROLE,
    type: 'checklist',
    subtype: 'confirmation',
    priority: 2,
    description: `Checklist: ${count} item${count !== 1 ? 's' : ''} to confirm`,
    workflowType: 'checklistConfirmation',
    envelope: {
      source: 'checklist-confirmation',
      // Item definitions go in envelope — render data, not a searchable facet.
      checklist_items: checklistItems,
      formDefaults: { items: initialState },
    },
    schemaVersion: CHECKLIST_SCHEMA_VERSION,
  });

  if (!decision) {
    return { type: 'return' as const, data: { cancelled: true } };
  }

  const summary = await summarizeChecklist(decision);
  return { type: 'return' as const, data: summary };
}
