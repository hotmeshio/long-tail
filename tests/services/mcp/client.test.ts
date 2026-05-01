import { describe, it, expect, afterEach } from 'vitest';

import {
  registerBuiltinServer,
  callServerTool,
  isConnected,
  clear,
} from '../../../services/mcp/client';
import { createTranslationServer } from '../../../system/mcp-servers/translation';

afterEach(() => {
  clear();
});

describe('MCP Client — built-in server resolution', () => {
  it('should dispatch a built-in tool call directly (no MCP transport)', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    // 'translation' should fuzzy-match 'long-tail-translation' and dispatch directly
    const result = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(result).toBeDefined();
    expect(result.translated_content).toBeDefined();
  });

  it('should succeed on repeated calls to the same built-in tool', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });

    // Second call reuses the cached server instance
    const result = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(result).toBeDefined();
    expect(result.translated_content).toBeDefined();
  });

  it('should resolve both full name and short alias to the same built-in server', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    // Call via full name
    const r1 = await callServerTool('long-tail-translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(r1.translated_content).toBeDefined();

    // Call via short alias — same server
    const r2 = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(r2.translated_content).toBeDefined();
  });

  it('should throw for unknown server', async () => {
    await expect(
      callServerTool('nonexistent-server', 'some_tool', {}),
    ).rejects.toThrow('not connected');
  });

  it('should not report unregistered server as connected', () => {
    expect(isConnected('long-tail-translation')).toBe(false);
    expect(isConnected('random-name')).toBe(false);
  });

  it('should clear cached server instances', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });

    clear();

    // After clear, the next call should re-create the server (lazy init)
    const result = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(result).toBeDefined();
  });
});
