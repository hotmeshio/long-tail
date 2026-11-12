import { describe, it, expect, vi, afterEach } from 'vitest';

import { clear, registerBuiltinServer, registeredBuiltinToolNames } from '../../../services/mcp/client';

describe('registeredBuiltinToolNames', () => {
  afterEach(() => clear());

  it('returns the tools the built-in server registered', async () => {
    registerBuiltinServer('lt-test-server', async () => ({ _registeredTools: { find_escalations: {}, claim_escalation: {} } }));
    expect(await registeredBuiltinToolNames('lt-test-server')).toEqual(new Set(['find_escalations', 'claim_escalation']));
  });

  it('creates the server once and reuses it', async () => {
    const factory = vi.fn(async () => ({ _registeredTools: { a: {} } }));
    registerBuiltinServer('lt-test-once', factory);
    await registeredBuiltinToolNames('lt-test-once');
    await registeredBuiltinToolNames('lt-test-once');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('returns null for a name with no built-in factory', async () => {
    expect(await registeredBuiltinToolNames('external-crm')).toBeNull();
  });
});
