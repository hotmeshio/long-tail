import * as subService from '../services/agent/subscriptions';
import { publishAgentEvent } from '../lib/events/publish';
import type { LTApiResult } from '../types/sdk';

function notifyTriggersChanged(agentId: string): void {
  publishAgentEvent({
    type: 'agent.triggers_changed' as any,
    agentId,
    agentName: agentId,
    data: { action: 'subscription_changed' },
  });
}

export async function listSubscriptions(input: { agentId: string }): Promise<LTApiResult> {
  try {
    const subs = await subService.listSubscriptions(input.agentId);
    return { status: 200, data: { subscriptions: subs } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function createSubscription(
  input: { agentId: string; [key: string]: any },
): Promise<LTApiResult> {
  try {
    const { agentId, ...data } = input;
    const sub = await subService.createSubscription(agentId, data);
    notifyTriggersChanged(agentId);
    return { status: 201, data: sub };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function updateSubscription(
  input: { id: string; [key: string]: any },
): Promise<LTApiResult> {
  try {
    const { id, ...data } = input;
    const sub = await subService.updateSubscription(id, data);
    if (!sub) return { status: 404, error: 'Subscription not found' };
    notifyTriggersChanged(sub.agent_id);
    return { status: 200, data: sub };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function deleteSubscription(input: { id: string }): Promise<LTApiResult> {
  try {
    const sub = await subService.getSubscription(input.id);
    const deleted = await subService.deleteSubscription(input.id);
    if (!deleted) return { status: 404, error: 'Subscription not found' };
    if (sub) notifyTriggersChanged(sub.agent_id);
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
