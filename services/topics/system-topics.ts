import type { LTTopicConfig } from '../../types';
import { seedTopic, resetTopic } from './index';
import { loggerRegistry } from '../../lib/logger';

// ── Shared schema fragments ────────────────────────────────────────────────────

const WORKFLOW_CONTEXT_PROPS = {
  workflowId:   { type: 'string', description: 'Workflow instance ID' },
  workflowName: { type: 'string', description: 'Workflow function name' },
  taskQueue:    { type: 'string', description: 'Task queue the workflow ran on' },
  originId:     { type: 'string', description: 'Root process lineage ID' },
};

const STATUS_FIELD = { type: 'string', description: 'Status after this event' };

function objectSchema(properties: Record<string, any>): Record<string, any> {
  return { type: 'object', properties };
}

// ── Built-in system topics ──────────────────────────────────────────────────────

const SYSTEM_TOPICS: LTTopicConfig[] = [
  // Task lifecycle
  {
    topic: 'task.created',
    description: 'A new task has been created and queued for execution.',
    category: 'task',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string', description: 'Task ID' }, status: STATUS_FIELD, data: { type: 'object', description: 'Task input data' } }),
    example_payload: { taskId: 'tsk-001', status: 'pending', workflowName: 'processOrder' },
    tags: ['lifecycle', 'core'],
  },
  {
    topic: 'task.started',
    description: 'A task has begun execution.',
    category: 'task',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string' }, status: STATUS_FIELD }),
    example_payload: { taskId: 'tsk-001', status: 'running', workflowName: 'processOrder' },
    tags: ['lifecycle', 'core'],
  },
  {
    topic: 'task.completed',
    description: 'A task has finished successfully.',
    category: 'task',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string' }, status: STATUS_FIELD, milestones: { type: 'array', items: { type: 'object' }, description: 'Milestones reported' }, data: { type: 'object', description: 'Task result data' } }),
    example_payload: { taskId: 'tsk-001', status: 'completed', workflowName: 'processOrder' },
    tags: ['lifecycle', 'core'],
  },
  {
    topic: 'task.escalated',
    description: 'A task has been escalated for human review.',
    category: 'task',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object' } }),
    example_payload: { taskId: 'tsk-001', status: 'escalated', workflowName: 'processOrder' },
    tags: ['lifecycle', 'escalation'],
  },
  {
    topic: 'task.failed',
    description: 'A task has failed execution.',
    category: 'task',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object', description: 'Error details' } }),
    example_payload: { taskId: 'tsk-001', status: 'failed', workflowName: 'processOrder' },
    tags: ['lifecycle', 'error'],
  },

  // Workflow lifecycle
  {
    topic: 'workflow.started',
    description: 'A workflow execution has started.',
    category: 'workflow',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string' }, status: STATUS_FIELD }),
    example_payload: { workflowId: 'wf-abc', workflowName: 'processOrder', status: 'running' },
    tags: ['lifecycle', 'core'],
  },
  {
    topic: 'workflow.completed',
    description: 'A workflow execution has completed successfully.',
    category: 'workflow',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object' } }),
    example_payload: { workflowId: 'wf-abc', workflowName: 'processOrder', status: 'completed' },
    tags: ['lifecycle', 'core'],
  },
  {
    topic: 'workflow.failed',
    description: 'A workflow execution has failed.',
    category: 'workflow',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, taskId: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object', description: 'Error details' } }),
    example_payload: { workflowId: 'wf-abc', workflowName: 'processOrder', status: 'failed' },
    tags: ['lifecycle', 'error'],
  },

  // Escalation lifecycle
  {
    topic: 'escalation.created',
    description: 'A new escalation has been created for human review.',
    category: 'escalation',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, escalationId: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object' } }),
    example_payload: { escalationId: 'esc-001', status: 'pending', workflowName: 'processOrder' },
    tags: ['lifecycle', 'hitl'],
  },
  {
    topic: 'escalation.resolved',
    description: 'An escalation has been resolved by a human operator.',
    category: 'escalation',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, escalationId: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object' } }),
    example_payload: { escalationId: 'esc-001', status: 'resolved', workflowName: 'processOrder' },
    tags: ['lifecycle', 'hitl'],
  },
  {
    topic: 'escalation.claimed',
    description: 'An escalation has been claimed by an operator.',
    category: 'escalation',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, escalationId: { type: 'string' }, status: STATUS_FIELD }),
    example_payload: { escalationId: 'esc-001', status: 'claimed' },
    tags: ['lifecycle', 'hitl'],
  },
  {
    topic: 'escalation.released',
    description: 'An escalation has been released back to the queue.',
    category: 'escalation',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, escalationId: { type: 'string' }, status: STATUS_FIELD }),
    example_payload: { escalationId: 'esc-001', status: 'pending' },
    tags: ['lifecycle', 'hitl'],
  },

  // Activity lifecycle
  {
    topic: 'activity.started',
    description: 'A YAML workflow activity step has started.',
    category: 'activity',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, activityName: { type: 'string', description: 'Activity step name' } }),
    example_payload: { workflowId: 'wf-abc', activityName: 'fetchOrder', workflowName: 'processOrder' },
    tags: ['lifecycle', 'yaml'],
  },
  {
    topic: 'activity.completed',
    description: 'A YAML workflow activity step has completed.',
    category: 'activity',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, activityName: { type: 'string' }, data: { type: 'object' } }),
    example_payload: { workflowId: 'wf-abc', activityName: 'fetchOrder', workflowName: 'processOrder' },
    tags: ['lifecycle', 'yaml'],
  },
  {
    topic: 'activity.failed',
    description: 'A YAML workflow activity step has failed.',
    category: 'activity',
    payload_schema: objectSchema({ ...WORKFLOW_CONTEXT_PROPS, activityName: { type: 'string' }, data: { type: 'object', description: 'Error details' } }),
    example_payload: { workflowId: 'wf-abc', activityName: 'fetchOrder', workflowName: 'processOrder' },
    tags: ['lifecycle', 'yaml', 'error'],
  },

  // Knowledge lifecycle
  {
    topic: 'knowledge.stored',
    description: 'A knowledge entry has been written to the knowledge store.',
    category: 'knowledge',
    payload_schema: objectSchema({ domain: { type: 'string', description: 'Knowledge domain' }, key: { type: 'string', description: 'Knowledge entry key' } }),
    example_payload: { domain: 'orders', key: 'order-12345' },
    tags: ['lifecycle', 'knowledge'],
  },
  {
    topic: 'knowledge.deleted',
    description: 'A knowledge entry has been removed from the knowledge store.',
    category: 'knowledge',
    payload_schema: objectSchema({ domain: { type: 'string', description: 'Knowledge domain' }, key: { type: 'string', description: 'Knowledge entry key' } }),
    example_payload: { domain: 'orders', key: 'order-12345' },
    tags: ['lifecycle', 'knowledge'],
  },

  // Agent lifecycle
  {
    topic: 'agent.started',
    description: 'An agent reaction workflow has started in response to an event.',
    category: 'agent',
    payload_schema: objectSchema({ agentId: { type: 'string', description: 'Agent ID' }, agentName: { type: 'string', description: 'Agent name' }, status: STATUS_FIELD, data: { type: 'object', description: 'Trigger context' } }),
    example_payload: { agentId: 'agt-001', agentName: 'error-handler', status: 'running' },
    tags: ['lifecycle', 'agent'],
  },
  {
    topic: 'agent.completed',
    description: 'An agent reaction workflow has completed successfully.',
    category: 'agent',
    payload_schema: objectSchema({ agentId: { type: 'string' }, agentName: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object' } }),
    example_payload: { agentId: 'agt-001', agentName: 'error-handler', status: 'completed' },
    tags: ['lifecycle', 'agent'],
  },
  {
    topic: 'agent.failed',
    description: 'An agent reaction workflow has failed.',
    category: 'agent',
    payload_schema: objectSchema({ agentId: { type: 'string' }, agentName: { type: 'string' }, status: STATUS_FIELD, data: { type: 'object', description: 'Error details' } }),
    example_payload: { agentId: 'agt-001', agentName: 'error-handler', status: 'failed' },
    tags: ['lifecycle', 'agent', 'error'],
  },
  {
    topic: 'agent.status_changed',
    description: 'An agent\'s status has changed (activated, paused, errored).',
    category: 'agent',
    payload_schema: objectSchema({ agentId: { type: 'string' }, agentName: { type: 'string' }, status: STATUS_FIELD }),
    example_payload: { agentId: 'agt-001', agentName: 'error-handler', status: 'active' },
    tags: ['lifecycle', 'agent'],
  },

  // Milestone
  {
    topic: 'milestone',
    description: 'A workflow or activity has reported progress milestones.',
    category: 'milestone',
    payload_schema: objectSchema({
      ...WORKFLOW_CONTEXT_PROPS,
      activityName: { type: 'string', description: 'Activity name (if from an activity)' },
      milestones: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { description: 'Milestone value (string, number, boolean, or object)' } } }, description: 'Milestones reported' },
    }),
    example_payload: { workflowId: 'wf-abc', workflowName: 'processOrder', milestones: [{ name: 'items_processed', value: 42 }] },
    tags: ['progress', 'core'],
  },
];

// ── Seeding ─────────────────────────────────────────────────────────────────────

/**
 * Derive the category from a topic string.
 * `app.*` → 'app', everything else → first segment.
 */
function inferCategory(topic: string): string {
  return topic.startsWith('app.') ? 'app' : topic.split('.')[0];
}

/**
 * Seed all 22 built-in system topics into the catalog.
 * Called once at startup after migrations.
 */
export async function seedSystemTopics(): Promise<void> {
  for (const def of SYSTEM_TOPICS) {
    try {
      const inserted = await seedTopic({
        topic: def.topic,
        description: def.description ?? '',
        category: def.category ?? inferCategory(def.topic),
        payload_schema: def.payload_schema,
        example_payload: def.example_payload,
        source: 'system',
        tags: def.tags ?? [],
      });
      if (inserted) loggerRegistry.info(`[long-tail] topic seeded: ${def.topic}`);
    } catch (err: any) {
      loggerRegistry.warn(`[long-tail] topic seed failed for ${def.topic}: ${err.message}`);
    }
  }
}

/**
 * Seed user-declared topics from startConfig.topics[].
 * Respects `reset: true` — overwrites DB from config on every boot.
 */
export async function seedConfigTopics(topics: LTTopicConfig[]): Promise<void> {
  for (const def of topics) {
    try {
      const payload = {
        topic: def.topic,
        description: def.description ?? '',
        category: def.category ?? inferCategory(def.topic),
        payload_schema: def.payload_schema,
        example_payload: def.example_payload,
        source: 'config',
        tags: def.tags ?? [],
      };

      if (def.reset) {
        await resetTopic(payload);
        loggerRegistry.info(`[long-tail] topic reset: ${def.topic} (config)`);
      } else {
        const inserted = await seedTopic(payload);
        if (inserted) loggerRegistry.info(`[long-tail] topic seeded: ${def.topic} (config)`);
      }
    } catch (err: any) {
      loggerRegistry.warn(`[long-tail] topic seed failed for ${def.topic}: ${err.message}`);
    }
  }
}
