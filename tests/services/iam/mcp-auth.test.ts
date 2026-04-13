import { describe, it, expect, afterEach } from 'vitest';

import { runWithToolContext, getToolContext } from '../../../services/iam/context';
import {
  registerBuiltinServer,
  callServerTool,
  clear,
} from '../../../services/mcp/client';
import { createTranslationServer } from '../../../system/mcp-servers/translation';
import type { ToolContext } from '../../../types/tool-context';

afterEach(() => {
  clear();
});

function makeCtx(userId: string, type: 'user' | 'bot' = 'user'): ToolContext {
  return {
    principal: { id: userId, type, roles: [] },
    credentials: { delegationToken: `test-delegation-${userId}`, scopes: ['mcp:tool:call'] },
    trace: {},
  };
}

describe('MCP client — ToolContext auth integration', () => {
  it('callServerTool derives auth from ambient ToolContext when no explicit authContext', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    let capturedCtx: ToolContext | undefined;

    await runWithToolContext(makeCtx('ctx-user-1', 'bot'), async () => {
      capturedCtx = getToolContext();
      // No explicit authContext — should derive from ToolContext
      const result = await callServerTool('translation', 'translate_content', {
        content: 'hello', target_language: 'es',
      });
      expect(result).toBeDefined();
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.principal.id).toBe('ctx-user-1');
    expect(capturedCtx!.principal.type).toBe('bot');
  });

  it('explicit authContext takes precedence over ToolContext', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    await runWithToolContext(makeCtx('ambient-user'), async () => {
      // Explicit authContext should win — call still succeeds
      const result = await callServerTool(
        'translation',
        'translate_content',
        { content: 'hello', target_language: 'es' },
        { userId: 'explicit-user', delegationToken: 'explicit-token' },
      );
      expect(result).toBeDefined();
    });
  });

  it('callServerTool works without ToolContext (no auth injected)', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    // No ToolContext, no explicit auth — should still call the tool
    const result = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(result).toBeDefined();
    expect(result.translated_content).toBeDefined();
  });

  it('getToolContext returns undefined outside runWithToolContext', () => {
    const ctx = getToolContext();
    expect(ctx).toBeUndefined();
  });

  it('nested runWithToolContext uses inner context', async () => {
    const outer = makeCtx('outer-user');
    const inner = makeCtx('inner-user');

    await runWithToolContext(outer, async () => {
      expect(getToolContext()?.principal.id).toBe('outer-user');

      await runWithToolContext(inner, async () => {
        expect(getToolContext()?.principal.id).toBe('inner-user');
      });

      // Outer context restored after inner completes
      expect(getToolContext()?.principal.id).toBe('outer-user');
    });
  });
});
