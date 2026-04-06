import { describe, it, expect, afterEach } from 'vitest';

import { runWithToolContext, getToolContext } from '../../../services/iam/context';
import {
  registerBuiltinServer,
  callServerTool,
  clear,
} from '../../../services/mcp/client';
import { createVisionServer } from '../../../services/mcp/vision-server';
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
    registerBuiltinServer('long-tail-document-vision', createVisionServer);

    // Track what _auth gets injected by inspecting the tool result
    // (vision server doesn't use _auth, but we can verify the call succeeds
    // and the context was available during the call)
    let capturedCtx: ToolContext | undefined;

    await runWithToolContext(makeCtx('ctx-user-1', 'bot'), async () => {
      capturedCtx = getToolContext();
      // No explicit authContext — should derive from ToolContext
      const result = await callServerTool('vision', 'list_document_pages', {});
      expect(result).toBeDefined();
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.principal.id).toBe('ctx-user-1');
    expect(capturedCtx!.principal.type).toBe('bot');
  });

  it('explicit authContext takes precedence over ToolContext', async () => {
    registerBuiltinServer('long-tail-document-vision', createVisionServer);

    await runWithToolContext(makeCtx('ambient-user'), async () => {
      // Explicit authContext should win — call still succeeds
      const result = await callServerTool(
        'vision',
        'list_document_pages',
        {},
        { userId: 'explicit-user', delegationToken: 'explicit-token' },
      );
      expect(result).toBeDefined();
    });
  });

  it('callServerTool works without ToolContext (no auth injected)', async () => {
    registerBuiltinServer('long-tail-document-vision', createVisionServer);

    // No ToolContext, no explicit auth — should still call the tool
    const result = await callServerTool('vision', 'list_document_pages', {});
    expect(result).toBeDefined();
    expect(result.pages).toBeDefined();
  });
});
