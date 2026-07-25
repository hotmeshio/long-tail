/**
 * Plate child workflow — one lone waiter per plate, the fan-out shape for
 * parallel human work (each child runs a single inline `conditionLT`; the
 * parent collects completion signals in one canonical `Promise.all` fan-in).
 *
 * The plate row carries the walk's `originId` facet — the rendezvous the
 * closeout form's embed, inline actions, and submit guard all query. When the
 * plate resolves (an inline Bagged ✓ from the closeout form, or the full
 * form), this child signals the parent and returns.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import {
  REL_PLATE_ROLE,
  REL_PLATE_SCHEMA_VERSION,
  type RelPlateResolverV1,
} from './forms-walk';

type ActivitiesType = typeof activities;

export interface PlateEnvelopeData {
  orderId: string;
  customerId: string;
  unit: string;
  originId: string;
  parentSignalId: string;
  parentWorkflowId: string;
}

export interface PlateDone {
  unit: string;
  bagged: boolean;
}

export async function relPlateWorkflow(envelope: LTEnvelope): Promise<any> {
  const { orderId, customerId, unit, originId, parentSignalId, parentWorkflowId } =
    envelope.data as unknown as PlateEnvelopeData;

  const { signalPlateDone } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  // One atomic wait: the plate row commits in this child's Leg1 checkpoint,
  // faceted with the walk's originId so the closeout form finds it.
  const payload = await conditionLT<RelPlateResolverV1>(`rel-plate-${unit}-${originId}`, {
    role: REL_PLATE_ROLE,
    type: 'walk',
    subtype: 'plate',
    priority: 2,
    description: `Bag plate — ${unit} · ${orderId}`,
    workflowType: 'relPlateWorkflow',
    envelope: {
      source: 'related-escalations',
      formDefaults: { orderId, unit, bagged: true, notes: '' },
    },
    metadata: { orderId, customerId, unit, originId },
    schemaVersion: REL_PLATE_SCHEMA_VERSION,
  });

  const result: PlateDone = {
    unit,
    bagged: payload !== null && payload !== false && payload.bagged === true,
  };

  await signalPlateDone({
    parentWorkflowId,
    signalId: parentSignalId,
    data: { ...result },
  });

  return { type: 'return' as const, data: result };
}
