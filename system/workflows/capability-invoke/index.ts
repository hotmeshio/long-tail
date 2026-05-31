/**
 * Capability Invoke — late-binding MCP tool invocation.
 *
 * A minimal durable workflow that calls a single MCP server tool.
 * Used by agent automation subscriptions with reaction_type 'capability'.
 *
 * The durable wrapper provides:
 * - Request idempotency via deterministic workflow ID
 * - Crash safety via HotMesh activity retry
 * - Audit trail via workflow execution records
 * - _scope threading via the interceptor
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const { callCapability } = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

export async function capabilityInvoke(
  envelope: LTEnvelope,
): Promise<LTReturn> {
  const { serverId, toolName, arguments: args } = envelope.data as {
    serverId: string;
    toolName: string;
    arguments: Record<string, any>;
  };

  const result = await callCapability({
    serverId,
    toolName,
    arguments: args ?? {},
  });

  return {
    type: 'return',
    data: {
      serverId,
      toolName,
      result,
    },
  };
}
