/**
 * Who may configure automation. Agents run on their own, as the identity they
 * name (an execute_as, else the agent's user_id) or, with none, as lt-system.
 * Whoever configures one must be able to run as that identity: the same rule
 * as an execute_as override. Automation that would run as lt-system, or a
 * capability subscription (a tool called with lt-system authority), is a
 * superadmin's to configure.
 */
import { assertMayActAs, InvocationError } from '../workflow-invocation';
import { isSuperAdmin } from '../user';
import { getAgent } from './index';
import { getSubscription } from './subscriptions';
import type { AgentBehaviors } from '../../types/agent';

const SYSTEM_AUTHORITY = 'runs as lt-system; only superadmin can configure it';

async function assertIdentity(callerId: string, identity: string | null | undefined, what: string): Promise<void> {
  if (!identity) throw new InvocationError(`${what} has no identity, so it ${SYSTEM_AUTHORITY}`, 403);
  await assertMayActAs(callerId, identity);
}

/** Refuse an agent create or update whose schedules the caller could not run themselves. */
export async function assertMayConfigureAgent(
  callerId: string,
  input: { id?: string; user_id?: string | null; behaviors?: AgentBehaviors },
): Promise<void> {
  if (await isSuperAdmin(callerId)) return;
  const existing = input.id ? await getAgent(input.id) : null;
  const userId = input.user_id !== undefined ? input.user_id : existing?.user_id ?? null;
  const behaviors = input.behaviors ?? existing?.behaviors;
  if (userId) await assertMayActAs(callerId, userId);
  if (behaviors?.cron) await assertIdentity(callerId, userId, 'the agent schedule');
  for (const schedule of behaviors?.schedules ?? []) {
    await assertIdentity(callerId, schedule.execute_as || userId, 'an agent schedule');
  }
}

/** Refuse a subscription create or update the caller could not run themselves. */
export async function assertMayConfigureSubscription(
  callerId: string,
  input: { agentId: string; subscriptionId?: string; reaction_type?: string; execute_as?: string | null },
): Promise<void> {
  if (await isSuperAdmin(callerId)) return;
  const existing = input.subscriptionId ? await getSubscription(input.subscriptionId) : null;
  if (input.subscriptionId && (!existing || existing.agent_id !== input.agentId)) {
    throw new InvocationError('Subscription not found', 404);
  }
  const reaction = input.reaction_type ?? existing?.reaction_type;
  if (reaction === 'capability') {
    throw new InvocationError(`a capability subscription calls a tool directly, so it ${SYSTEM_AUTHORITY}`, 403);
  }
  const agent = await getAgent(input.agentId);
  const executeAs = input.execute_as !== undefined ? input.execute_as : existing?.execute_as;
  await assertIdentity(callerId, executeAs || agent?.user_id, 'the subscription');
}
