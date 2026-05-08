import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as filesApi from '../../../api/files';

// Mock the storage backend
vi.mock('../../../lib/storage', () => {
  const mockBackend = {
    listWithPrefixes: vi.fn(),
    getMetadata: vi.fn(),
    getSignedUrl: vi.fn(),
  };
  return {
    getStorageBackend: () => mockBackend,
    __mockBackend: mockBackend,
  };
});

import { getStorageBackend } from '../../../lib/storage';

const mockBackend = getStorageBackend() as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('browseFiles', () => {
  it('returns files and directories from backend', async () => {
    mockBackend.listWithPrefixes.mockResolvedValue({
      files: [{ path: 'a.txt', size: 10, modified_at: '2026-01-01T00:00:00Z' }],
      directories: ['sub/'],
      nextToken: 'abc',
    });

    const result = await filesApi.browseFiles({ prefix: 'test/' });
    expect(result.status).toBe(200);
    expect(result.data.files).toHaveLength(1);
    expect(result.data.directories).toEqual(['sub/']);
    expect(result.data.nextToken).toBe('abc');
  });

  it('passes pageSize and continuationToken to backend', async () => {
    mockBackend.listWithPrefixes.mockResolvedValue({ files: [], directories: [] });

    await filesApi.browseFiles({ prefix: 'p/', pageSize: 50, continuationToken: 'tok' });
    expect(mockBackend.listWithPrefixes).toHaveBeenCalledWith('p/', 50, 'tok');
  });

  it('defaults pageSize to 100', async () => {
    mockBackend.listWithPrefixes.mockResolvedValue({ files: [], directories: [] });

    await filesApi.browseFiles({});
    expect(mockBackend.listWithPrefixes).toHaveBeenCalledWith(undefined, 100, undefined);
  });

  it('returns 500 on backend error', async () => {
    mockBackend.listWithPrefixes.mockRejectedValue(new Error('S3 unreachable'));

    const result = await filesApi.browseFiles({});
    expect(result.status).toBe(500);
    expect(result.error).toContain('S3 unreachable');
  });
});

describe('getFileMetadata', () => {
  it('returns metadata with path included', async () => {
    mockBackend.getMetadata.mockResolvedValue({
      size: 1024,
      modified_at: '2026-01-01T00:00:00Z',
      content_type: 'image/png',
    });

    const result = await filesApi.getFileMetadata({ filePath: 'img/photo.png' });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({
      path: 'img/photo.png',
      size: 1024,
      modified_at: '2026-01-01T00:00:00Z',
      content_type: 'image/png',
    });
  });

  it('returns 404 when file not found', async () => {
    mockBackend.getMetadata.mockRejectedValue(new Error('File not found: missing.txt'));

    const result = await filesApi.getFileMetadata({ filePath: 'missing.txt' });
    expect(result.status).toBe(404);
    expect(result.error).toContain('not found');
  });

  it('returns 500 on unexpected error', async () => {
    mockBackend.getMetadata.mockRejectedValue(new Error('Disk failure'));

    const result = await filesApi.getFileMetadata({ filePath: 'file.txt' });
    expect(result.status).toBe(500);
    expect(result.error).toContain('Disk failure');
  });
});

describe('generateSignedUrl', () => {
  it('returns url and expiresAt for valid expiry', async () => {
    mockBackend.getSignedUrl.mockResolvedValue('https://signed.example.com/file?token=xyz');

    const result = await filesApi.generateSignedUrl({ filePath: 'doc.pdf', expiresIn: 3600 });
    expect(result.status).toBe(200);
    expect(result.data.url).toContain('signed.example.com');
    expect(result.data.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects invalid expiry values', async () => {
    const result = await filesApi.generateSignedUrl({ filePath: 'doc.pdf', expiresIn: 999 });
    expect(result.status).toBe(400);
    expect(result.error).toContain('expiresIn must be one of');
  });

  it('accepts all valid expiry values', async () => {
    mockBackend.getSignedUrl.mockResolvedValue('https://url');

    for (const exp of [3600, 21600, 86400, 604800, 2592000]) {
      const result = await filesApi.generateSignedUrl({ filePath: 'f', expiresIn: exp });
      expect(result.status).toBe(200);
    }
  });

  it('returns 500 on backend error', async () => {
    mockBackend.getSignedUrl.mockRejectedValue(new Error('No credentials'));

    const result = await filesApi.generateSignedUrl({ filePath: 'f', expiresIn: 3600 });
    expect(result.status).toBe(500);
    expect(result.error).toContain('No credentials');
  });
});
