import type { InvocableWorkflow } from '../../../../api/types';

/** Shared fixtures for the invoke page tests. */
export function invocable(overrides: Partial<InvocableWorkflow> & { workflow_type: string }): InvocableWorkflow {
  return {
    description: null,
    invocable: true,
    certified: false,
    task_queue: 'long-tail-examples',
    default_role: 'reviewer',
    roles: [],
    invocation_roles: [],
    consumes: [],
    envelope_schema: null,
    input_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
    tier: 'registered',
    ...overrides,
  };
}

export const REVIEW = invocable({
  workflow_type: 'reviewContent',
  task_queue: 'long-tail-examples-reviewContent',
  description: 'Review user-generated content',
  envelope_schema: { data: { message: 'hello', copies: 1 }, metadata: { source: 'dashboard' } },
});

export const CLAIM = invocable({
  workflow_type: 'processClaim',
  task_queue: 'long-tail-examples-processClaim',
  description: 'Process insurance claims',
  execute_as: 'lt-system',
});

export const DURABLE = invocable({
  workflow_type: 'durableOnly',
  task_queue: 'durable-queue',
  tier: 'durable',
});

export const RICH_SCHEMA = {
  'x-lt-layout': 'two-column',
  'x-lt-help': 'Tool for {{input.serialNumber}}',
  required: ['serialNumber', 'action'],
  properties: {
    serialNumber: { type: 'string', title: 'Serial', 'x-lt-bind': 'printer.serialNumber', description: 'The label serial' },
    action: { type: 'string', title: 'Action', enum: ['reprint-label', 'retire'], 'x-lt-bind': 'tool.action', description: 'Pick one' },
    copies: { type: 'number', title: 'Copies', minimum: 1, default: 1, 'x-lt-showIf': 'input.action=reprint-label', description: 'How many' },
    reprintTips: { type: 'string', 'x-lt-widget': 'markdown', readOnly: true, default: '### Reprint tips', 'x-lt-showIf': 'input.action=reprint-label' },
  },
};

export const TOOLS = invocable({
  workflow_type: 'fleetTools',
  task_queue: 'long-tail-examples',
  description: 'Fleet tools',
  input_schema: RICH_SCHEMA,
  envelope_schema: { data: {}, metadata: { source: 'dashboard' } },
});
