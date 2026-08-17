/**
 * Parameterized Form Workflow — the reference example for per-row form
 * parameterization. The `verdict-reviewer` role owns ONE static form_schema;
 * each escalation's envelope carries only the small per-order data that
 * varies:
 *
 *   - x-lt-options            — the quantity dropdowns offer [0..N] where N is
 *                               this order's per-side count; the Return To
 *                               select offers this order's legal stations
 *   - x-lt-require-sum        — both quantities default to 0; their sum must
 *                               reach 1, so an all-zero verdict cannot submit
 *
 * Invoke via the dashboard (Workflows → parameterizedForm) with:
 *   {
 *     data: {
 *       left_count: 3,
 *       right_count: 2,
 *       return_stations: ["molding", "finishing"]
 *     },
 *     metadata: { source: 'dashboard' }
 *   }
 *
 * Vary the counts and stations per invocation to see the same role form offer
 * different legal values per row. Omit any data field to use the defaults.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import { VERDICT_ROLE, VERDICT_SCHEMA_VERSION, type VerdictResolverV1 } from './forms';

type ActivitiesType = typeof activities;

const DEFAULT_LEFT_COUNT = 3;
const DEFAULT_RIGHT_COUNT = 2;
const DEFAULT_RETURN_STATIONS = ['molding', 'finishing', 'assembly'];
const MAX_SIDE_COUNT = 20;

/** The select's legal range for one side: 0 (unaffected) through the order's count. */
function quantityOptions(count: number): number[] {
  const n = Math.max(1, Math.min(MAX_SIDE_COUNT, Math.floor(count)));
  return Array.from({ length: n + 1 }, (_, i) => i);
}

export async function parameterizedForm(envelope: LTEnvelope): Promise<any> {
  const leftCount: number = Number(envelope.data.left_count ?? DEFAULT_LEFT_COUNT);
  const rightCount: number = Number(envelope.data.right_count ?? DEFAULT_RIGHT_COUNT);
  const returnStations: string[] = Array.isArray(envelope.data.return_stations)
    ? (envelope.data.return_stations as string[])
    : DEFAULT_RETURN_STATIONS;

  const { processVerdict } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `parameterized-form-${ctx.workflowId}`;

  const decision = await conditionLT<VerdictResolverV1>(signalId, {
    role: VERDICT_ROLE,
    type: 'verdict',
    subtype: 'sided-verdict',
    priority: 2,
    description: `Sided verdict — left 0..${leftCount}, right 0..${rightCount}`,
    workflowType: 'parameterizedForm',
    envelope: {
      source: 'parameterized-form',
      left_quantity_options: quantityOptions(leftCount),
      right_quantity_options: quantityOptions(rightCount),
      return_stations: returnStations,
    },
    schemaVersion: VERDICT_SCHEMA_VERSION,
  });

  if (!decision) {
    return { type: 'return' as const, data: { cancelled: true } };
  }

  const result = await processVerdict(decision);
  return { type: 'return' as const, data: result };
}
