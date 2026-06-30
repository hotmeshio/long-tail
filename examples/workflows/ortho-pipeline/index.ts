/**
 * Ortho Pipeline — MCP-operable manufacturing workflow.
 *
 * Models the 8-stage orthotics manufacturing process (design → review → print →
 * grid → glue → finish → qa → ship) as a durable HotMesh workflow. Each stage
 * creates an escalation atomically via Durable.workflow.condition() (Leg1 write)
 * and suspends. Resolving via MCP (ortho_complete_stage) auto-resumes the
 * workflow via signal_key with no separate signal call.
 *
 * The boilerplate's ortho:run benchmark drives the same role queues without
 * conflict — the MCP surface is the production-facing interface.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { ORTHO_STAGES } from './types';
import type { StageResult } from './types';

export async function orthoPipeline(envelope: LTEnvelope): Promise<unknown> {
  const {
    order_id = 'ORDER-001',
    item_type = 'insole-standard',
    stages = [...ORTHO_STAGES],
    metadata: orderMetadata = {},
  } = (envelope.data ?? {}) as {
    order_id?: string;
    item_type?: string;
    stages?: string[];
    metadata?: Record<string, unknown>;
  };

  const ctx = Durable.workflow.workflowInfo();
  const results: StageResult[] = [];

  for (const stage of stages) {
    const signalId = `ortho-${stage}-${ctx.workflowId}`;

    const resolution = await Durable.workflow.condition<Record<string, unknown>>(signalId, {
      type: 'ortho-stage',
      subtype: stage,
      role: stage,
      description: `${stage} — order ${order_id} (${item_type})`,
      metadata: { signal_id: signalId, order_id, item_type, stage, ...orderMetadata },
    });

    results.push({
      stage,
      completed_at: new Date().toISOString(),
      resolution: (resolution === false || !resolution) ? {} : resolution,
    });
  }

  return {
    type: 'return' as const,
    data: { order_id, item_type, results },
  };
}
