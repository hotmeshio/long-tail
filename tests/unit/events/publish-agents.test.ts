import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventRegistry } from '../../../lib/events';
import { InMemoryEventAdapter } from '../../../lib/events/memory';
import { publishKnowledgeEvent, publishAgentEvent } from '../../../lib/events/publish';

describe('agent and knowledge event publishing', () => {
  let adapter: InMemoryEventAdapter;

  beforeEach(() => {
    adapter = new InMemoryEventAdapter();
    eventRegistry.register(adapter);
  });

  afterEach(async () => {
    await eventRegistry.disconnect();
    (eventRegistry as any).adapters = [];
  });

  it('publishKnowledgeEvent emits knowledge.stored', async () => {
    await eventRegistry.connect();
    await publishKnowledgeEvent({ type: 'knowledge.stored', domain: 'test', key: 'k1' });
    expect(adapter.events.length).toBe(1);
    expect(adapter.events[0].type).toBe('system.knowledge.test.stored');
    expect(adapter.events[0].source).toBe('knowledge');
    expect(adapter.events[0].data).toEqual({ domain: 'test', key: 'k1' });
  });

  it('publishKnowledgeEvent emits knowledge.deleted', async () => {
    await eventRegistry.connect();
    await publishKnowledgeEvent({ type: 'knowledge.deleted', domain: 'test', key: 'k1' });
    expect(adapter.events[0].type).toBe('system.knowledge.test.deleted');
  });

  it('publishAgentEvent emits agent.started', async () => {
    await eventRegistry.connect();
    await publishAgentEvent({ type: 'agent.started', agentId: 'a1', agentName: 'test-agent' });
    expect(adapter.events.length).toBe(1);
    expect(adapter.events[0].type).toBe('system.agent.test-agent.started');
    expect(adapter.events[0].source).toBe('agent');
    expect(adapter.events[0].workflowId).toBe('a1');
    expect(adapter.events[0].workflowName).toBe('test-agent');
  });

  it('publishAgentEvent emits agent.status_changed with data', async () => {
    await eventRegistry.connect();
    await publishAgentEvent({ type: 'agent.status_changed', agentId: 'a1', agentName: 'test', status: 'paused', data: { previous: 'active' } });
    expect(adapter.events[0].status).toBe('paused');
    expect(adapter.events[0].data).toEqual({ previous: 'active' });
  });
});
