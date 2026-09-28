import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../../../services/domain', () => ({
  getDomainIndex: vi.fn(async () => null),
  getDomainDictionary: vi.fn(async () => null),
}));

import { createUnifiedMcpServer, SHIPPED_SERVERS } from '../../../services/mcp/external-server';
import { builtinMcpServerFactories } from '../../../system';
import { ALL_CAPABILITIES, MEMBER_CAPABILITIES } from '../../helpers/capability-sets';
import type { CapabilitySet } from '../../../types';

const NONE: CapabilitySet = { ...MEMBER_CAPABILITIES, caller: false };
const ONLY = (gate: keyof CapabilitySet): CapabilitySet => ({ ...MEMBER_CAPABILITIES, [gate]: true });

async function toolNames(capabilities: CapabilitySet, scopes?: string[]): Promise<string[]> {
  const server = await createUnifiedMcpServer(capabilities, undefined, scopes);
  return Object.keys((server as any)._registeredTools);
}

describe('/mcp tool gates', () => {
  it('every tool a shipped server registers declares a gate in its manifest', async () => {
    for (const name of SHIPPED_SERVERS) {
      const entry = builtinMcpServerFactories[name];
      if (!entry) continue;
      const server = await entry.factory();
      const manifest = entry.config?.toolManifest ?? [];
      for (const tool of Object.keys((server as any)._registeredTools ?? {})) {
        const gate = manifest.find((t) => t.name === tool)?.gate;
        expect(gate, `${name}.${tool} has no gate`).toBeDefined();
      }
    }
  });

  it('a caller with no capability sees no tools', async () => {
    expect(await toolNames(NONE)).toEqual([]);
  });

  it('a member sees role-scoped and reference tools only', async () => {
    const names = await toolNames(MEMBER_CAPABILITIES);
    expect(names).toEqual(expect.arrayContaining(['find_escalations', 'resolve_escalation', 'invoke_workflow', 'list_users', 'read_doc']));
    for (const hidden of ['create_user', 'add_user_role', 'remove_user_role', 'prune', 'create_persona', 'list_bot_accounts',
      'deploy_yaml_workflow', 'terminate_workflow', 'store_knowledge', 'get_knowledge', 'http_request', 'write_file',
      'execute_task', 'get_access_token', 'list_connections', 'publish_event']) {
      expect(names, hidden).not.toContain(hidden);
    }
  });

  it('admin, builder and role-manager capabilities follow their REST gates', async () => {
    const admin = await toolNames(ONLY('admin'));
    expect(admin).toEqual(expect.arrayContaining(['prune', 'remove_user_role', 'upsert_workflow_config', 'diagnose_job']));
    expect(admin).not.toContain('create_user');
    expect(admin).not.toContain('create_persona');

    const builder = await toolNames(ONLY('builder'));
    expect(builder).toEqual(expect.arrayContaining(['create_user', 'list_bot_accounts', 'rollcall', 'store_knowledge', 'deploy_yaml_workflow']));
    expect(builder).not.toContain('prune');

    const roleManager = await toolNames(ONLY('roleManager'));
    expect(roleManager).toEqual(expect.arrayContaining(['create_role', 'create_persona', 'list_personas', 'publish_announcement']));
    expect(roleManager).not.toContain('create_user');
  });

  it('assigning roles and reading stored credentials need superadmin', async () => {
    const everythingButSuperadmin = await toolNames({ ...ALL_CAPABILITIES, superadmin: false });
    const superadmin = await toolNames(ALL_CAPABILITIES);
    for (const tool of ['add_user_role', 'get_access_token', 'list_connections', 'revoke_connection']) {
      expect(everythingButSuperadmin).not.toContain(tool);
      expect(superadmin).toContain(tool);
    }
  });

  it('hides a tool whose manifest entry has no gate', async () => {
    const entry = builtinMcpServerFactories['long-tail-docs'].config!.toolManifest!.find((t) => t.name === 'read_doc')!;
    const gate = entry.gate;
    delete entry.gate;
    try {
      expect(await toolNames(ALL_CAPABILITIES)).not.toContain('read_doc');
    } finally {
      entry.gate = gate;
    }
  });

  it('read scope and gates compose', async () => {
    const names = await toolNames(MEMBER_CAPABILITIES, ['mcp:read']);
    expect(names).toContain('find_escalations');
    expect(names).not.toContain('resolve_escalation');
    expect(names).not.toContain('list_bot_accounts');
  });

  it('a member cannot call a tool they cannot see', async () => {
    const server = await createUnifiedMcpServer(MEMBER_CAPABILITIES);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'gate-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = (await client.listTools()).tools.map((t) => t.name);
      expect(listed).not.toContain('prune');
      const result = await client.callTool({ name: 'prune', arguments: {} }).catch((err: Error) => ({ isError: true, err }));
      expect((result as any).isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
