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
  it('should auto-connect a built-in server on first callServerTool', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    // 'translation' should fuzzy-match 'long-tail-translation'
    const result = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(result).toBeDefined();
    expect(result.translated_content).toBeDefined();

    // Client should now be cached
    expect(isConnected('translation')).toBe(true);
  });

  it('should reuse cached client for the same serverId', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    // First call auto-connects
    await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(isConnected('translation')).toBe(true);

    // Second call reuses — no "already connected" error
    const result = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(result).toBeDefined();
  });

  it('should alias different serverIds to the same canonical factory', async () => {
    registerBuiltinServer('long-tail-translation', createTranslationServer);

    // Connect via full name
    await callServerTool('long-tail-translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(isConnected('long-tail-translation')).toBe(true);

    // 'translation' should find the same client via alias (no double-connect)
    const result = await callServerTool('translation', 'translate_content', {
      content: 'hello', target_language: 'es',
    });
    expect(result.translated_content).toBeDefined();
    expect(isConnected('translation')).toBe(true);
  });

  it('should throw for unknown server', async () => {
    await expect(
      callServerTool('nonexistent-server', 'some_tool', {}),
    ).rejects.toThrow('not connected');
  });
});
