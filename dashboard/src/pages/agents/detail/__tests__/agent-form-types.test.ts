import { describe, it, expect } from 'vitest';
import {
  isStepValid,
  agentToForm,
  formToAgentPayload,
  formToSubscriptionPayloads,
  EMPTY_FORM,
  EMPTY_SUBSCRIPTION,
  EMPTY_SCHEDULE,
} from '../agent-form-types';
import type { AgentFormState, ScheduleFormState, SubscriptionFormState } from '../agent-form-types';

// ── isStepValid ─────────────────────────────────────────────────────

describe('isStepValid', () => {
  it('step 1 (Identity) requires name', () => {
    expect(isStepValid(1, { ...EMPTY_FORM, name: '' })).toBe(false);
    expect(isStepValid(1, { ...EMPTY_FORM, name: 'bot' })).toBe(true);
  });

  it('step 4 (Subscriptions) validates each subscription', () => {
    const validSub: SubscriptionFormState = {
      ...EMPTY_SUBSCRIPTION,
      topic: 'workflow.failed',
      reaction_type: 'durable',
      workflow_type: 'basicEcho',
    };
    expect(isStepValid(4, { ...EMPTY_FORM, subscriptions: [validSub] })).toBe(true);

    const invalidSub = { ...validSub, topic: '' };
    expect(isStepValid(4, { ...EMPTY_FORM, subscriptions: [invalidSub] })).toBe(false);
  });

  it('step 5 (Schedules) requires cron and workflow_type for durable', () => {
    const validSched: ScheduleFormState = {
      ...EMPTY_SCHEDULE,
      cron: '0 * * * *',
      reaction_type: 'durable',
      workflow_type: 'basicEcho',
    };
    expect(isStepValid(5, { ...EMPTY_FORM, schedules: [validSched] })).toBe(true);

    expect(isStepValid(5, { ...EMPTY_FORM, schedules: [{ ...validSched, cron: '' }] })).toBe(false);
    expect(isStepValid(5, { ...EMPTY_FORM, schedules: [{ ...validSched, workflow_type: '' }] })).toBe(false);
  });

  it('step 5 (Schedules) requires cron and pipeline_id for pipeline', () => {
    const validPipeline: ScheduleFormState = {
      ...EMPTY_SCHEDULE,
      cron: '*/15 * * * *',
      reaction_type: 'pipeline',
      pipeline_id: 'pipe-123',
    };
    expect(isStepValid(5, { ...EMPTY_FORM, schedules: [validPipeline] })).toBe(true);
    expect(isStepValid(5, { ...EMPTY_FORM, schedules: [{ ...validPipeline, pipeline_id: '' }] })).toBe(false);
  });

  it('empty subscriptions and schedules are valid', () => {
    expect(isStepValid(4, EMPTY_FORM)).toBe(true);
    expect(isStepValid(5, EMPTY_FORM)).toBe(true);
  });
});

// ── agentToForm ─────────────────────────────────────────────────────

describe('agentToForm', () => {
  it('maps agent with behaviors.schedules to form state', () => {
    const agent = {
      id: '1', name: 'health-monitor', description: 'Monitors health',
      status: 'active', goals: 'Detect failures', rules: 'No auto-restart',
      user_id: 'bot-1', knowledge_domain: 'system-health',
      behaviors: {
        schedules: [
          { cron: '0 * * * *', workflow_type: 'basicEcho', envelope: { data: { source: 'cron' } }, execute_as: 'bot-2' },
          { cron: '*/15 * * * *', workflow_type: 'reviewContent' },
        ],
      },
      capabilities: null, workflow_type: null, pipeline_id: null, metadata: null,
      created_at: '', updated_at: '',
    };

    const form = agentToForm(agent as any, []);

    expect(form.name).toBe('health-monitor');
    expect(form.schedules).toHaveLength(2);
    expect(form.schedules[0].cron).toBe('0 * * * *');
    expect(form.schedules[0].reaction_type).toBe('durable');
    expect(form.schedules[0].workflow_type).toBe('basicEcho');
    expect(form.schedules[0].pipeline_id).toBe('');
    expect(form.schedules[0].envelope).toBe('{\n  "data": {\n    "source": "cron"\n  }\n}');
    expect(form.schedules[0].execute_as).toBe('bot-2');
    expect(form.schedules[1].cron).toBe('*/15 * * * *');
    expect(form.schedules[1].reaction_type).toBe('durable');
    expect(form.schedules[1].workflow_type).toBe('reviewContent');
    expect(form.schedules[1].envelope).toBe('{}');
    expect(form.schedules[1].execute_as).toBe('');
  });

  it('maps subscriptions to form state', () => {
    const agent = {
      id: '1', name: 'test', behaviors: {}, status: 'active',
      description: null, goals: null, rules: null, user_id: null,
      knowledge_domain: null, capabilities: null, workflow_type: null,
      pipeline_id: null, metadata: null, created_at: '', updated_at: '',
    };

    const subs = [
      {
        id: 'sub-1', agent_id: '1', topic: 'workflow.failed',
        reaction_type: 'durable' as const, workflow_type: 'basicEcho',
        pipeline_id: undefined, mcp_prompt: undefined,
        filter: { status: 422 }, input_mapping: { data: { error: '{event.status}' } },
        execute_as: 'bot-3', enabled: true, created_at: '', updated_at: '',
      },
    ];

    const form = agentToForm(agent as any, subs);

    expect(form.subscriptions).toHaveLength(1);
    expect(form.subscriptions[0].topic).toBe('workflow.failed');
    expect(form.subscriptions[0].workflow_type).toBe('basicEcho');
    expect(form.subscriptions[0].filter).toBe('{\n  "status": 422\n}');
    expect(form.subscriptions[0].execute_as).toBe('bot-3');
    expect(form.subscriptions[0].enabled).toBe(true);
  });

  it('handles agent with no schedules or subscriptions', () => {
    const agent = {
      id: '1', name: 'empty', behaviors: {}, status: 'active',
      description: null, goals: null, rules: null, user_id: null,
      knowledge_domain: null, capabilities: null, workflow_type: null,
      pipeline_id: null, metadata: null, created_at: '', updated_at: '',
    };

    const form = agentToForm(agent as any, []);
    expect(form.schedules).toHaveLength(0);
    expect(form.subscriptions).toHaveLength(0);
  });
});

// ── formToAgentPayload ──────────────────────────────────────────────

describe('formToAgentPayload', () => {
  it('maps durable schedules to behaviors.schedules with parsed envelope', () => {
    const form: AgentFormState = {
      ...EMPTY_FORM,
      name: 'test-agent',
      schedules: [
        { cron: '0 * * * *', reaction_type: 'durable', workflow_type: 'basicEcho', pipeline_id: '', envelope: '{"data":{"source":"cron"}}', execute_as: 'bot-1' },
        { cron: '*/15 * * * *', reaction_type: 'durable', workflow_type: 'reviewContent', pipeline_id: '', envelope: '{}', execute_as: '' },
      ],
    };

    const payload = formToAgentPayload(form);

    expect(payload.name).toBe('test-agent');
    expect(payload.behaviors.schedules).toHaveLength(2);
    expect(payload.behaviors.schedules[0]).toEqual({
      cron: '0 * * * *',
      reaction_type: 'durable',
      workflow_type: 'basicEcho',
      pipeline_id: undefined,
      envelope: { data: { source: 'cron' } },
      execute_as: 'bot-1',
    });
    expect(payload.behaviors.schedules[1]).toEqual({
      cron: '*/15 * * * *',
      reaction_type: 'durable',
      workflow_type: 'reviewContent',
      pipeline_id: undefined,
      envelope: {},
      execute_as: undefined,
    });
    expect(payload.behaviors.cron).toBe('0 * * * *');
    expect(payload.workflow_type).toBe('basicEcho');
  });

  it('maps pipeline schedules with pipeline_id and no workflow_type', () => {
    const form: AgentFormState = {
      ...EMPTY_FORM,
      name: 'pipe-agent',
      schedules: [
        { cron: '*/5 * * * *', reaction_type: 'pipeline', workflow_type: '', pipeline_id: 'pipe-abc', envelope: '{}', execute_as: '' },
      ],
    };

    const payload = formToAgentPayload(form);

    expect(payload.behaviors.schedules[0]).toEqual({
      cron: '*/5 * * * *',
      reaction_type: 'pipeline',
      workflow_type: undefined,
      pipeline_id: 'pipe-abc',
      envelope: {},
      execute_as: undefined,
    });
  });

  it('empty schedules produce no behaviors.schedules', () => {
    const payload = formToAgentPayload(EMPTY_FORM);
    expect(payload.behaviors.schedules).toBeUndefined();
    expect(payload.behaviors.cron).toBeUndefined();
  });
});

// ── formToSubscriptionPayloads ──────────────────────────────────────

describe('formToSubscriptionPayloads', () => {
  it('maps subscriptions with parsed filter and input_mapping', () => {
    const form: AgentFormState = {
      ...EMPTY_FORM,
      subscriptions: [
        {
          ...EMPTY_SUBSCRIPTION,
          topic: 'workflow.failed',
          reaction_type: 'durable',
          workflow_type: 'basicEcho',
          filter: '{"status": 422}',
          input_mapping: '{"data":{"error":"{event.status}"}}',
          execute_as: 'bot-1',
          enabled: true,
        },
      ],
    };

    const payloads = formToSubscriptionPayloads(form);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].topic).toBe('workflow.failed');
    expect(payloads[0].filter).toEqual({ status: 422 });
    expect(payloads[0].input_mapping).toEqual({ data: { error: '{event.status}' } });
    expect(payloads[0].execute_as).toBe('bot-1');
  });

  it('empty filter and execute_as produce undefined', () => {
    const form: AgentFormState = {
      ...EMPTY_FORM,
      subscriptions: [
        {
          ...EMPTY_SUBSCRIPTION,
          topic: 'app.>',
          reaction_type: 'durable',
          workflow_type: 'basicEcho',
          filter: '',
          execute_as: '',
        },
      ],
    };

    const payloads = formToSubscriptionPayloads(form);
    expect(payloads[0].filter).toBeUndefined();
    expect(payloads[0].execute_as).toBeUndefined();
  });
});
