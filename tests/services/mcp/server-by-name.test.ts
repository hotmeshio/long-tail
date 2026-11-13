import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import * as mcpDb from '../../../services/mcp/db';
import { callServerTool } from '../../../services/mcp/client/tools';
import { getClients } from '../../../services/mcp/client/connection-lifecycle';

// A tool call names an external server by its id or its name.
const NAME = `acme-ledger-${Date.now()}`;

describe('calling a tool on an external server by name', () => {
  let serverId: string;
  const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ balance: 12 }) }] }));

  beforeAll(async () => {
    await migrate();
    const server = await mcpDb.createMcpServer({
      name: NAME, transport_type: 'sse', transport_config: { url: 'http://localhost:9/sse' },
    } as any);
    serverId = server.id;
    getClients().set(serverId, { callTool } as any);
  }, 30_000);

  afterAll(async () => {
    for (const key of [serverId, NAME]) getClients().delete(key);
    await mcpDb.deleteMcpServer(serverId);
  });

  it('returns null for a server id that is not a uuid', async () => {
    await expect(mcpDb.getMcpServer(NAME)).resolves.toBeNull();
  });

  it('calls the same connected server by name as by id', async () => {
    expect(await callServerTool(serverId, 'get_balance', { account: 'a-1' })).toEqual({ balance: 12 });
    expect(await callServerTool(NAME, 'get_balance', { account: 'a-1' })).toEqual({ balance: 12 });
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenLastCalledWith(
      { name: 'get_balance', arguments: expect.objectContaining({ account: 'a-1' }) },
      undefined,
      expect.anything(),
    );
  });
});
