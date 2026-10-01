import { describe, it, expect, vi, beforeEach } from 'vitest';

// A built-in tool called as a named caller sees that caller as an external
// principal; internal dispatch passes none and keeps lt-system.
const handler = vi.fn(async (args: any, extra?: any) => ({
  content: [{ type: 'text', text: JSON.stringify({ caller: extra?.authInfo?.userId ?? null, args }) }],
}));
vi.mock('../../../services/mcp/client/connection-lifecycle', () => ({
  getClients: () => new Map(),
  getBuiltinFactories: () => new Map([['long-tail-admin', async () => ({ _registeredTools: { probe: { handler } } })]]),
  getBuiltinServers: () => new Map(),
}));

import { dispatchBuiltinTool } from '../../../services/mcp/client/connection-dispatch';

beforeEach(() => handler.mockClear());

describe('dispatchBuiltinTool', () => {
  it('internal dispatch passes no caller', async () => {
    const out = await dispatchBuiltinTool('long-tail-admin', 'probe', { a: 1 });
    expect(out?.result).toEqual({ caller: null, args: { a: 1 } });
    expect(handler.mock.calls[0]).toHaveLength(1);
  });

  it('a named caller reaches the handler as authInfo', async () => {
    const out = await dispatchBuiltinTool('long-tail-admin', 'probe', { a: 1 }, { authInfo: { userId: 'u-1', role: 'member' } });
    expect(out?.result).toEqual({ caller: 'u-1', args: { a: 1 } });
  });

  it('an unknown tool is not dispatched', async () => {
    expect(await dispatchBuiltinTool('long-tail-admin', 'nope', {})).toBeNull();
  });
});
