import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stored images are a builder read, as at /api/file-browser; URLs and data
// URIs stay open, and internal dispatch (no caller) reads storage freely.

const mocks = vi.hoisted(() => ({
  mayBuild: vi.fn(),
  read: vi.fn(),
  callLLM: vi.fn(),
}));
vi.mock('../../../services/llm', () => ({ hasLLMApiKey: () => true, callLLM: mocks.callLLM }));
vi.mock('../../../lib/storage', () => ({ getStorageBackend: () => ({ read: mocks.read }) }));
vi.mock('../../../modules/capabilities', async (io) => ({
  ...(await io<typeof import('../../../modules/capabilities')>()),
  mayBuild: mocks.mayBuild,
}));

import { createVisionServer, STORAGE_READ_DENIED } from '../../../system/mcp-servers/vision';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const member = { authInfo: { userId: '11111111-1111-4111-8111-111111111111', role: 'member' } };

async function describeImage(image: string, extra?: unknown) {
  const server = await createVisionServer({ fresh: true } as any);
  const tool = (server as any)._registeredTools.describe_image;
  const result = await tool.handler({ image }, extra);
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ data: PNG_1PX });
  mocks.callLLM.mockResolvedValue({ content: '{"description":"a pixel","tags":[]}' });
});

describe('vision storage reads', () => {
  it('a non-builder caller cannot read a stored image', async () => {
    mocks.mayBuild.mockResolvedValue(false);
    await expect(describeImage('screenshots/secret.png', member)).rejects.toThrow(STORAGE_READ_DENIED);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('a builder reads a stored image', async () => {
    mocks.mayBuild.mockResolvedValue(true);
    await describeImage('screenshots/ok.png', member);
    expect(mocks.read).toHaveBeenCalledWith('screenshots/ok.png');
  });

  it('a URL or data URI needs no builder access', async () => {
    mocks.mayBuild.mockResolvedValue(false);
    await describeImage('https://example.com/a.png', member);
    await describeImage(`data:image/png;base64,${PNG_1PX.toString('base64')}`, member);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.callLLM).toHaveBeenCalledTimes(2);
  });

  it('internal dispatch with no caller reads storage', async () => {
    await describeImage('screenshots/pipeline.png');
    expect(mocks.mayBuild).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalled();
  });
});
