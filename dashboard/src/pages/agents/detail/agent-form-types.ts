import type { Agent, AgentBehaviors } from '../../../api/agents';
import type { AgentSubscription } from '../../../api/agent-subscriptions';

export interface SubscriptionFormState {
  id?: string;
  topic: string;
  filter: string;
  reaction_type: 'durable' | 'pipeline' | 'mcp_query';
  workflow_type: string;
  pipeline_id: string;
  mcp_prompt: string;
  input_mapping: string;
  execute_as: string;
  enabled: boolean;
}

export interface ScheduleFormState {
  cron: string;
  reaction_type: 'durable' | 'pipeline';
  workflow_type: string;
  pipeline_id: string;
  envelope: string; // JSON string
  execute_as: string;
}

export interface AgentFormState {
  name: string;
  description: string;
  goals: string;
  rules: string;
  user_id: string;
  knowledge_domain: string;
  subscriptions: SubscriptionFormState[];
  schedules: ScheduleFormState[];
}

export const EMPTY_FORM: AgentFormState = {
  name: '',
  description: '',
  goals: '',
  rules: '',
  user_id: '',
  knowledge_domain: '',
  subscriptions: [],
  schedules: [],
};

export const STEP_LABELS = ['Identity', 'Motivation', 'Knowledge', 'Subscriptions', 'Schedule', 'Review'];

export const EMPTY_SUBSCRIPTION: SubscriptionFormState = {
  topic: '',
  filter: '',
  reaction_type: 'durable',
  workflow_type: '',
  pipeline_id: '',
  mcp_prompt: '',
  input_mapping: '{}',
  execute_as: '',
  enabled: true,
};

export const EMPTY_SCHEDULE: ScheduleFormState = {
  cron: '0 * * * *',
  reaction_type: 'durable',
  workflow_type: '',
  pipeline_id: '',
  envelope: '{}',
  execute_as: '',
};

export function isStepValid(step: number, form: AgentFormState): boolean {
  switch (step) {
    case 1: return form.name.trim().length > 0;
    case 2: return true;
    case 3: return true;
    case 4: {
      return form.subscriptions.every((s) => {
        if (!s.topic.trim()) return false;
        if (s.reaction_type === 'durable' && !s.workflow_type) return false;
        if (s.reaction_type === 'pipeline' && !s.pipeline_id) return false;
        if (s.reaction_type === 'mcp_query' && !s.mcp_prompt) return false;
        return true;
      });
    }
    case 5: {
      return form.schedules.every((s) => {
        if (!s.cron) return false;
        if (s.reaction_type === 'pipeline') return !!s.pipeline_id;
        return !!s.workflow_type;
      });
    }
    case 6: return true;
    default: return true;
  }
}

export function agentToForm(
  agent: Agent,
  subscriptions: AgentSubscription[],
): AgentFormState {
  // Parse schedules from behaviors.schedules or fall back to legacy single cron
  const schedules: ScheduleFormState[] = agent.behaviors?.schedules?.length
    ? (agent.behaviors.schedules as any[]).map((s: any) => ({
        cron: s.cron || '',
        reaction_type: s.reaction_type || 'durable',
        workflow_type: s.workflow_type || '',
        pipeline_id: s.pipeline_id || '',
        envelope: s.envelope ? JSON.stringify(s.envelope, null, 2) : '{}',
        execute_as: s.execute_as || '',
      }))
    : agent.behaviors?.cron
      ? [{ cron: agent.behaviors.cron, reaction_type: 'durable' as const, workflow_type: agent.workflow_type ?? '', pipeline_id: '', envelope: '{}', execute_as: '' }]
      : [];

  return {
    name: agent.name,
    description: agent.description ?? '',
    goals: agent.goals ?? '',
    rules: agent.rules ?? '',
    user_id: agent.user_id ?? '',
    knowledge_domain: agent.knowledge_domain ?? '',
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      topic: s.topic,
      filter: s.filter ? JSON.stringify(s.filter, null, 2) : '',
      reaction_type: s.reaction_type,
      workflow_type: s.workflow_type ?? '',
      pipeline_id: s.pipeline_id ?? '',
      mcp_prompt: s.mcp_prompt ?? '',
      input_mapping: JSON.stringify(s.input_mapping ?? {}, null, 2),
      execute_as: s.execute_as ?? '',
      enabled: s.enabled,
    })),
    schedules,
  };
}

export function formToAgentPayload(form: AgentFormState): Record<string, any> {
  const behaviors: AgentBehaviors = {};
  // Store schedules array in behaviors
  if (form.schedules.length > 0) {
    (behaviors as any).schedules = form.schedules.map((s) => ({
      cron: s.cron,
      reaction_type: s.reaction_type || 'durable',
      workflow_type: s.reaction_type === 'pipeline' ? undefined : s.workflow_type,
      pipeline_id: s.reaction_type === 'pipeline' ? s.pipeline_id : undefined,
      envelope: tryParseJson(s.envelope) ?? {},
      execute_as: s.execute_as || undefined,
    }));
    // Legacy compat: also set top-level cron from first schedule
    behaviors.cron = form.schedules[0].cron;
  }

  return {
    name: form.name,
    description: form.description || undefined,
    goals: form.goals || undefined,
    rules: form.rules || undefined,
    user_id: form.user_id || undefined,
    knowledge_domain: form.knowledge_domain || undefined,
    behaviors,
    workflow_type: form.schedules[0]?.workflow_type || undefined,
    pipeline_id: undefined,
  };
}

export function formToSubscriptionPayloads(form: AgentFormState): Array<{
  id?: string;
  topic: string;
  filter?: Record<string, any>;
  reaction_type: string;
  workflow_type?: string;
  pipeline_id?: string;
  mcp_prompt?: string;
  input_mapping: Record<string, any>;
  execute_as?: string;
  enabled: boolean;
}> {
  return form.subscriptions.map((s) => ({
    id: s.id,
    topic: s.topic,
    filter: s.filter ? tryParseJson(s.filter) : undefined,
    reaction_type: s.reaction_type,
    workflow_type: s.workflow_type || undefined,
    pipeline_id: s.pipeline_id || undefined,
    mcp_prompt: s.mcp_prompt || undefined,
    input_mapping: tryParseJson(s.input_mapping) ?? {},
    execute_as: s.execute_as || undefined,
    enabled: s.enabled,
  }));
}

function tryParseJson(s: string): Record<string, any> | undefined {
  if (!s.trim()) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}

export const sectionCls = 'section-header mt-[3em] first:mt-0';
export const labelCls = 'label';
export const hintCls = 'hint';
export const inputCls = 'input';
export const jsonCls = 'input-json w-full';
