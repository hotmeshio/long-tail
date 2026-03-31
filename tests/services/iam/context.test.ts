import { describe, it, expect } from 'vitest';

import { runWithToolContext, getToolContext } from '../../../services/iam/context';
import type { ToolContext } from '../../../types/tool-context';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    principal: { id: 'user-1', type: 'user', roles: ['reviewer'], roleType: 'member' },
    credentials: { scopes: ['mcp:tool:call'] },
    trace: {},
    ...overrides,
  };
}

describe('ToolContext (AsyncLocalStorage)', () => {
  it('getToolContext returns undefined outside execution scope', () => {
    expect(getToolContext()).toBeUndefined();
  });

  it('runWithToolContext makes context available inside callback', async () => {
    const ctx = makeCtx();
    await runWithToolContext(ctx, async () => {
      const retrieved = getToolContext();
      expect(retrieved).toBe(ctx);
      expect(retrieved!.principal.id).toBe('user-1');
    });
  });

  it('context is cleared after callback completes', async () => {
    await runWithToolContext(makeCtx(), async () => {
      expect(getToolContext()).toBeDefined();
    });
    expect(getToolContext()).toBeUndefined();
  });

  it('nested contexts isolate correctly', async () => {
    const outer = makeCtx({ principal: { id: 'outer', type: 'user', roles: [] } });
    const inner = makeCtx({ principal: { id: 'inner', type: 'bot', roles: [] } });

    await runWithToolContext(outer, async () => {
      expect(getToolContext()!.principal.id).toBe('outer');

      await runWithToolContext(inner, async () => {
        expect(getToolContext()!.principal.id).toBe('inner');
        expect(getToolContext()!.principal.type).toBe('bot');
      });

      // Outer context restored after inner completes
      expect(getToolContext()!.principal.id).toBe('outer');
    });
  });

  it('concurrent contexts do not leak between calls', async () => {
    const results: string[] = [];

    const run = async (id: string, delayMs: number) => {
      const ctx = makeCtx({ principal: { id, type: 'user', roles: [] } });
      await runWithToolContext(ctx, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        results.push(getToolContext()!.principal.id);
      });
    };

    await Promise.all([
      run('fast', 5),
      run('slow', 20),
    ]);

    expect(results).toContain('fast');
    expect(results).toContain('slow');
    expect(results.length).toBe(2);
  });

  it('propagates through async chains (setTimeout, Promise)', async () => {
    const ctx = makeCtx();
    await runWithToolContext(ctx, async () => {
      // Nested promise
      const result = await new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve(getToolContext()!.principal.id);
        }, 5);
      });
      expect(result).toBe('user-1');
    });
  });
});
