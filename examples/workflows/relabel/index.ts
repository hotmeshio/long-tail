/**
 * Relabel — reprint a label when its text changes.
 *
 * A target's label is often printed before every fact on it is known. This
 * workflow parks one escalation on the relabeler role asking for the label's
 * second line, then prints the label through a label transport. The print is
 * recorded in the label ledger like any other, here by the system bot, keyed
 * by the workflow id so a replay never prints twice.
 *
 * Invoke with: { data: { template: 'bin-label', target: 'A-3' } }
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditional } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import { RELABELER_ROLE, RELABELER_SCHEMA_VERSION, type RelabelV1 } from './forms';

type ActivitiesType = typeof activities;

export async function relabel(envelope: LTEnvelope): Promise<any> {
  const template = String(envelope.data.template ?? '').trim();
  const target = String(envelope.data.target ?? '').trim();
  if (!template || !target) return { type: 'return' as const, data: { error: 'template and target are required' } };

  const { printLabel } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
    retry: { maximumAttempts: 3 },
  });
  const { workflowId } = Durable.workflow.workflowInfo();

  const answer = await conditional<RelabelV1>(`relabel-${workflowId}`, {
    role: RELABELER_ROLE,
    type: 'label',
    subtype: 'relabel',
    priority: 3,
    description: `Relabel ${target}`,
    workflowType: 'relabel',
    metadata: { labelTarget: target, labelTemplate: template },
    schemaVersion: RELABELER_SCHEMA_VERSION,
  });
  if (!answer) return { type: 'return' as const, data: { target, cancelled: true } };

  const printed = await printLabel({ template, target, subtitle: answer.subtitle, workflowId });
  return { type: 'return' as const, data: { target, subtitle: answer.subtitle, label: printed } };
}

export { RELABELER_ROLE, RELABELER_FORM_SCHEMA } from './forms';
