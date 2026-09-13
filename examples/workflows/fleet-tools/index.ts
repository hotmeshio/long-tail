/**
 * Fleet Tools Workflow
 *
 * The invoke-form reference: an operator picks a tool for one machine on the
 * Invoke page and the x-lt-* form composes the request. The workflow
 * receives the x-lt-bind payload (`printer.serialNumber`, `tool.action`,
 * `tool.details.*`) and applies the tool through one activity.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import * as activities from './activities';
import type { FleetToolsInput } from './forms';

type ActivitiesType = typeof activities;

const { applyFleetTool } = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
});

export async function fleetTools(envelope: LTEnvelope): Promise<any> {
  const input = envelope.data as FleetToolsInput;
  const summary = await applyFleetTool(input);
  return {
    type: 'return' as const,
    data: { ...summary, userId: envelope.lt?.userId },
  };
}

export { FLEET_TOOLS_INPUT_SCHEMA, FLEET_TOOLS_ENVELOPE_METADATA } from './forms';
