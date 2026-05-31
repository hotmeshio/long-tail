import { createHash } from 'crypto';

import { loggerRegistry } from '../../lib/logger';
import { publishAgentEvent } from '../../lib/events/publish';
import { subjectMatchesPattern } from '../../lib/events/matching';
import type { LTEvent } from '../../types';
import type { CallbackEventAdapter } from '../../lib/events/callback';
import { listActiveSubscriptions, type ActiveSubscription } from './subscriptions';
import { applyInputMapping } from './input-mapper';
import { updateAgent } from './index';

/**
 * Agent Trigger Registry — arms event subscriptions for active agents at startup.
 *
 * Analogous to LTCronRegistry but for event-driven reactions. When an event
 * matches a subscription's topic pattern (and optional filter), the registry
 * invokes the configured workflow with a deterministic ID for distributed dedup.
 */
class AgentTriggerRegistry {
  private adapter: CallbackEventAdapter | null = null;
  private unsubs = new Map<string, () => void>();
  private connected = false;

  /**
   * Load all active subscriptions from DB and arm event listeners.
   */
  async connect(adapter: CallbackEventAdapter): Promise<void> {
    this.adapter = adapter;

    const subs = await listActiveSubscriptions();
    for (const sub of subs) {
      this.armSubscription(sub);
    }

    this.connected = true;
    loggerRegistry.info(`[long-tail] agent trigger registry: ${subs.length} subscription(s) armed`);
  }

  /**
   * Re-arm all subscriptions for a specific agent (after config change).
   */
  async restartAgent(agentId: string): Promise<void> {
    if (!this.adapter) return;

    // Stop existing subs for this agent
    for (const [key, unsub] of this.unsubs) {
      if (key.startsWith(`${agentId}:`)) {
        unsub();
        this.unsubs.delete(key);
      }
    }

    // Reload from DB
    const subs = await listActiveSubscriptions();
    const agentSubs = subs.filter((s) => s.agent_id === agentId);
    for (const sub of agentSubs) {
      this.armSubscription(sub);
    }

    loggerRegistry.info(`[long-tail] agent triggers restarted for ${agentId}: ${agentSubs.length} sub(s)`);
  }

  /**
   * Stop all subscriptions for a specific agent.
   */
  stopAgent(agentId: string): void {
    for (const [key, unsub] of this.unsubs) {
      if (key.startsWith(`${agentId}:`)) {
        unsub();
        this.unsubs.delete(key);
      }
    }
  }

  /**
   * Disconnect all subscriptions.
   */
  disconnect(): void {
    for (const unsub of this.unsubs.values()) {
      unsub();
    }
    this.unsubs.clear();
    this.connected = false;
    loggerRegistry.info('[long-tail] agent trigger registry disconnected');
  }

  private armSubscription(sub: ActiveSubscription): void {
    if (!this.adapter) return;

    const key = `${sub.agent_id}:${sub.id}`;
    const handler = this.buildHandler(sub);

    // Normalize topic: strip the 'lt.events.' prefix if present, since
    // CallbackEventAdapter matches against raw event.type (e.g., 'workflow.failed',
    // not 'lt.events.workflow.failed'). Users may store either form in the DB.
    const rawTopic = sub.topic.replace(/^lt\.events\./, '');
    const unsub = this.adapter.on(rawTopic, handler);
    this.unsubs.set(key, unsub);
  }

  private buildHandler(sub: ActiveSubscription): (event: LTEvent) => void {
    return async (event: LTEvent) => {
      try {
        // 1. Evaluate optional filter
        if (sub.filter && !this.matchesFilter(event, sub.filter)) {
          return;
        }

        // 2. Derive deterministic workflow ID for distributed dedup
        const deterministicId = this.deriveWorkflowId(sub, event);

        // 3. Apply input mapping to transform event → envelope data
        const mapped = Object.keys(sub.input_mapping).length > 0
          ? applyInputMapping(sub.input_mapping, event)
          : { data: event.data ?? {}, metadata: { source: 'agent', agentName: sub.agent_name } };

        // 4. Emit agent.started
        publishAgentEvent({
          type: 'agent.started',
          agentId: sub.agent_id,
          agentName: sub.agent_name,
          data: { topic: sub.topic, eventType: event.type, deterministicId },
        });

        // 5. Invoke the reaction workflow
        await this.executeReaction(sub, mapped, deterministicId);

        // 6. Emit agent.completed + update last_run_at
        publishAgentEvent({
          type: 'agent.completed',
          agentId: sub.agent_id,
          agentName: sub.agent_name,
          data: { topic: sub.topic, eventType: event.type },
        });

        updateAgent(sub.agent_id, {
          last_run_at: new Date().toISOString(),
        }).catch(() => {}); // best-effort
      } catch (err: any) {
        publishAgentEvent({
          type: 'agent.failed',
          agentId: sub.agent_id,
          agentName: sub.agent_name,
          status: 'error',
          data: { topic: sub.topic, error: err.message },
        });
        loggerRegistry.warn(`[long-tail] agent trigger failed: ${sub.agent_name}/${sub.topic}: ${err.message}`);
      }
    };
  }

  /**
   * Shallow key-value match: every key in filter must match the corresponding
   * key in event.data. Missing keys in event.data fail the match.
   */
  private matchesFilter(event: LTEvent, filter: Record<string, any>): boolean {
    const data = event.data ?? {};
    for (const [key, expected] of Object.entries(filter)) {
      if (data[key] !== expected) return false;
    }
    return true;
  }

  /**
   * Deterministic workflow ID derived from the subscription + event.
   * Multiple containers receiving the same event produce the same ID,
   * so HotMesh's idempotent workflow.start() prevents duplicate execution.
   */
  private deriveWorkflowId(sub: ActiveSubscription, event: LTEvent): string {
    const eventKey = event.workflowId || event.taskId || event.escalationId || '';
    const uniquePart = eventKey || createHash('sha256')
      .update(`${event.timestamp}:${event.type}:${JSON.stringify(event.data ?? {})}`)
      .digest('hex')
      .slice(0, 12);
    return `agent-${sub.agent_id}-${sub.id.slice(0, 8)}-${uniquePart}`;
  }

  private async executeReaction(
    sub: ActiveSubscription,
    mapped: Record<string, any>,
    deterministicId: string,
  ): Promise<void> {
    switch (sub.reaction_type) {
      case 'durable': {
        const { invokeWorkflow } = await import('../workflow-invocation');
        await invokeWorkflow({
          workflowType: sub.workflow_type!,
          data: mapped.data ?? mapped,
          metadata: mapped.metadata ?? { source: 'agent', certified: true },
          executeAs: sub.execute_as ?? sub.agent_user_id ?? undefined,
          options: { workflowId: deterministicId },
          auth: { userId: sub.agent_user_id || 'lt-system', role: 'admin' },
        });
        break;
      }
      case 'pipeline': {
        const { invokeYamlWorkflow } = await import('../yaml-workflow/invoke');
        const { getYamlWorkflow } = await import('../yaml-workflow/db');
        const wf = await getYamlWorkflow(sub.pipeline_id!);
        if (!wf) throw new Error(`Pipeline ${sub.pipeline_id} not found`);
        await invokeYamlWorkflow(wf, {
          data: mapped.data ?? mapped,
          execute_as: sub.execute_as ?? sub.agent_user_id ?? undefined,
          source: 'agent',
          jobId: deterministicId,
        });
        break;
      }
      case 'mcp_query': {
        const { startMcpQuery } = await import('../insight');
        await startMcpQuery({
          prompt: sub.mcp_prompt!,
          wait: false,
          userId: sub.agent_user_id ?? undefined,
        });
        break;
      }
      case 'capability': {
        loggerRegistry.info(
          `[long-tail] agent capability: ${sub.agent_name} → ${sub.tool_name} on ${sub.server_id} (id=${deterministicId})`,
        );
        const { invokeWorkflow } = await import('../workflow-invocation');
        await invokeWorkflow({
          workflowType: 'capabilityInvoke',
          data: {
            serverId: sub.server_id!,
            toolName: sub.tool_name!,
            arguments: mapped,
          },
          metadata: { source: 'agent' },
          executeAs: sub.execute_as ?? sub.agent_user_id ?? undefined,
          options: { workflowId: deterministicId },
          auth: { userId: sub.agent_user_id || 'lt-system', role: 'admin' },
        });
        break;
      }
    }
  }
}

export const agentTriggerRegistry = new AgentTriggerRegistry();
