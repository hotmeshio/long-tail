import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { LocalStorageBackend } from '../../../lib/storage/local';

const TEST_DIR = path.join(os.tmpdir(), `lt-storage-test-${Date.now()}`);

// Override env for the test
process.env.LT_FILE_STORAGE_DIR = TEST_DIR;
process.env.JWT_SECRET = 'test-secret-for-signed-urls';

function createBackend() {
  // Re-require to pick up env override
  return new LocalStorageBackend();
}

describe('LocalStorageBackend — new methods', () => {
  let backend: LocalStorageBackend;

  beforeAll(async () => {
    backend = createBackend();
    // Seed test files
    await backend.write('docs/readme.txt', Buffer.from('hello'));
    await backend.write('docs/notes.md', Buffer.from('# Notes'));
    await backend.write('images/photo.png', Buffer.from('fakepng'));
    await backend.write('images/logo.svg', Buffer.from('<svg/>'));
    await backend.write('root-file.json', Buffer.from('{}'));
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ── listWithPrefixes ──────────────────────────────────────────────────────

  describe('listWithPrefixes', () => {
    it('lists root directories and files', async () => {
      const result = await backend.listWithPrefixes();
      expect(result.directories).toContain('docs/');
      expect(result.directories).toContain('images/');
      expect(result.files.some((f) => f.path === 'root-file.json')).toBe(true);
    });

    it('lists files in a subdirectory', async () => {
      const result = await backend.listWithPrefixes('docs');
      expect(result.files).toHaveLength(2);
      const names = result.files.map((f) => path.basename(f.path));
      expect(names).toContain('readme.txt');
      expect(names).toContain('notes.md');
      expect(result.directories).toHaveLength(0);
    });

    it('lists files in a subdirectory with trailing slash', async () => {
      const result = await backend.listWithPrefixes('images/');
      expect(result.files).toHaveLength(2);
      expect(result.directories).toHaveLength(0);
    });

    it('returns empty for non-existent directory', async () => {
      const result = await backend.listWithPrefixes('nonexistent/');
      expect(result.files).toHaveLength(0);
      expect(result.directories).toHaveLength(0);
    });

    it('paginates with pageSize and continuationToken', async () => {
      const page1 = await backend.listWithPrefixes(undefined, 2);
      const totalItems = page1.files.length + page1.directories.length;
      expect(totalItems).toBe(2);
      expect(page1.nextToken).toBeDefined();

      const page2 = await backend.listWithPrefixes(undefined, 2, page1.nextToken);
      expect(page2.files.length + page2.directories.length).toBeGreaterThan(0);
    });

    it('returns file metadata (size, modified_at)', async () => {
      const result = await backend.listWithPrefixes('docs');
      const readme = result.files.find((f) => f.path.includes('readme'));
      expect(readme).toBeDefined();
      expect(readme!.size).toBe(5); // 'hello' = 5 bytes
      expect(readme!.modified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ── getMetadata ───────────────────────────────────────────────────────────

  describe('getMetadata', () => {
    it('returns size, modified_at, and content_type', async () => {
      const meta = await backend.getMetadata('docs/readme.txt');
      expect(meta.size).toBe(5);
      expect(meta.content_type).toBe('text/plain');
      expect(meta.modified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('resolves content_type from extension', async () => {
      const png = await backend.getMetadata('images/photo.png');
      expect(png.content_type).toBe('image/png');

      const svg = await backend.getMetadata('images/logo.svg');
      expect(svg.content_type).toBe('image/svg+xml');

      const json = await backend.getMetadata('root-file.json');
      expect(json.content_type).toBe('application/json');
    });

    it('throws for non-existent file', async () => {
      await expect(backend.getMetadata('nonexistent.txt')).rejects.toThrow('not found');
    });
  });

  // ── getSignedUrl ──────────────────────────────────────────────────────────

  describe('getSignedUrl', () => {
    it('returns a URL with a JWT token', async () => {
      const url = await backend.getSignedUrl('docs/readme.txt', 3600);
      expect(url).toContain('/api/files/docs/readme.txt');
      expect(url).toContain('token=');
    });

    it('strips leading slashes from the path', async () => {
      const url = await backend.getSignedUrl('/docs/readme.txt', 3600);
      expect(url).toContain('/api/files/docs/readme.txt');
      expect(url).not.toContain('//docs');
    });

    it('throws when JWT_SECRET is not set', async () => {
      const saved = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        await expect(backend.getSignedUrl('file.txt', 3600)).rejects.toThrow('JWT_SECRET');
      } finally {
        process.env.JWT_SECRET = saved;
      }
    });
  });
});
