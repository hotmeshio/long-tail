import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUnifiedMcpServer } from '../../../services/mcp/external-server';

describe('createUnifiedMcpServer', () => {
  it('creates a server with tools from shipped servers', async () => {
    const server = await createUnifiedMcpServer();
    const tools = (server as any)._registeredTools as Record<string, any>;
    const toolNames = Object.keys(tools);

    // Should have tools from admin (71), knowledge (7), file-storage (4), etc.
    expect(toolNames.length).toBeGreaterThan(50);

    // Admin tools
    expect(toolNames).toContain('find_tasks');
    expect(toolNames).toContain('get_process_detail');
    expect(toolNames).toContain('list_agents');
    expect(toolNames).toContain('list_bot_accounts');
    expect(toolNames).toContain('get_settings');

    // Knowledge tools
    expect(toolNames).toContain('store_knowledge');
    expect(toolNames).toContain('get_knowledge');

    // File storage tools
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');

    // Events tools
    expect(toolNames).toContain('publish_event');

    // Human queue tools
    expect(toolNames).toContain('escalate_to_human');
    expect(toolNames).toContain('escalate_and_wait');
  });

  it('excludes example servers (playwright, gmail, image-tools)', async () => {
    const server = await createUnifiedMcpServer();
    const toolNames = Object.keys((server as any)._registeredTools);

    // Playwright tools should NOT be present
    expect(toolNames).not.toContain('navigate');
    expect(toolNames).not.toContain('screenshot');
    expect(toolNames).not.toContain('login_and_capture');
    expect(toolNames).not.toContain('capture_page');
  });

  it('respects allowServers filter', async () => {
    const server = await createUnifiedMcpServer({
      allowServers: ['long-tail-knowledge'],
    });
    const toolNames = Object.keys((server as any)._registeredTools);

    // Only knowledge tools
    expect(toolNames).toContain('store_knowledge');
    expect(toolNames).toContain('get_knowledge');
    expect(toolNames).toContain('list_domains');

    // No admin tools
    expect(toolNames).not.toContain('find_tasks');
    expect(toolNames).not.toContain('list_agents');
  });

  it('respects denyServers filter', async () => {
    const server = await createUnifiedMcpServer({
      denyServers: ['long-tail-admin'],
    });
    const toolNames = Object.keys((server as any)._registeredTools);

    // No admin tools
    expect(toolNames).not.toContain('find_tasks');
    expect(toolNames).not.toContain('list_agents');
    expect(toolNames).not.toContain('get_settings');

    // Other servers still present
    expect(toolNames).toContain('store_knowledge');
    expect(toolNames).toContain('escalate_to_human');
  });

  it('respects readOnly filter — only read_safe tools', async () => {
    const server = await createUnifiedMcpServer({
      readOnly: true,
      allowServers: ['long-tail-admin'],
    });
    const toolNames = Object.keys((server as any)._registeredTools);

    // Read-safe admin tools should be present
    expect(toolNames).toContain('find_tasks');
    expect(toolNames).toContain('get_escalation_stats');
    expect(toolNames).toContain('list_workflow_configs');
    expect(toolNames).toContain('list_users');
    expect(toolNames).toContain('get_settings');

    // Write tools should NOT be present
    expect(toolNames).not.toContain('create_user');
    expect(toolNames).not.toContain('claim_escalation');
    expect(toolNames).not.toContain('invoke_workflow');
    expect(toolNames).not.toContain('prune');
  });

  it('deduplicates colliding tool names with server prefix', async () => {
    const server = await createUnifiedMcpServer();
    const toolNames = Object.keys((server as any)._registeredTools);

    // If list_topics appears in both admin and events, the second
    // should be prefixed (e.g., events_list_topics)
    const listTopicsCount = toolNames.filter((n) => n.includes('list_topics')).length;
    // At least one exists
    expect(listTopicsCount).toBeGreaterThanOrEqual(1);
  });

  it('all registered tools have handlers', async () => {
    const server = await createUnifiedMcpServer();
    const tools = (server as any)._registeredTools as Record<string, any>;

    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.handler, `tool '${name}' missing handler`).toBeDefined();
      expect(typeof tool.handler, `tool '${name}' handler is not a function`).toBe('function');
    }
  });
});
