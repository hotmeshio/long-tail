import { describe, it, expect, afterEach } from 'vitest';

import {
  registerBuiltinServer,
  callServerTool,
  isConnected,
  clear,
} from '../../../services/mcp/client';
import { createVisionServer } from '../../../services/mcp/vision-server';

afterEach(() => {
  clear();
});

describe('MCP Client — built-in server resolution', () => {
  it('should auto-connect a built-in server on first callServerTool', async () => {
    registerBuiltinServer('long-tail-document-vision', createVisionServer);

    // 'vision' should fuzzy-match 'long-tail-document-vision'
    const result = await callServerTool('vision', 'list_document_pages', {});
    expect(result).toBeDefined();
    expect(result.pages).toBeDefined();
    expect(Array.isArray(result.pages)).toBe(true);

    // Client should now be cached
    expect(isConnected('vision')).toBe(true);
  });

  it('should reuse cached client for the same serverId', async () => {
    registerBuiltinServer('long-tail-document-vision', createVisionServer);

    // First call auto-connects
    await callServerTool('vision', 'list_document_pages', {});
    expect(isConnected('vision')).toBe(true);

    // Second call reuses — no "already connected" error
    const result = await callServerTool('vision', 'validate_member', {
      member_info: { memberId: 'MBR-2024-001', name: 'John Smith' },
    });
    expect(result).toBeDefined();
  });

  it('should alias different serverIds to the same canonical factory', async () => {
    registerBuiltinServer('long-tail-document-vision', createVisionServer);

    // Connect via full name
    await callServerTool('long-tail-document-vision', 'list_document_pages', {});
    expect(isConnected('long-tail-document-vision')).toBe(true);

    // 'vision' should find the same client via alias (no double-connect)
    const result = await callServerTool('vision', 'list_document_pages', {});
    expect(result.pages).toBeDefined();
    expect(isConnected('vision')).toBe(true);
  });

  it('should throw for unknown server', async () => {
    await expect(
      callServerTool('nonexistent-server', 'some_tool', {}),
    ).rejects.toThrow('not connected');
  });
});
