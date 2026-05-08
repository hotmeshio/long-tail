import { describe, it, expect } from 'vitest';
import { mimeFromPath, MIME_TYPES } from '../../../lib/storage/mime';

describe('MIME_TYPES', () => {
  it('maps common image extensions', () => {
    expect(MIME_TYPES['.png']).toBe('image/png');
    expect(MIME_TYPES['.jpg']).toBe('image/jpeg');
    expect(MIME_TYPES['.gif']).toBe('image/gif');
    expect(MIME_TYPES['.svg']).toBe('image/svg+xml');
    expect(MIME_TYPES['.webp']).toBe('image/webp');
  });

  it('maps common text extensions', () => {
    expect(MIME_TYPES['.txt']).toBe('text/plain');
    expect(MIME_TYPES['.html']).toBe('text/html');
    expect(MIME_TYPES['.css']).toBe('text/css');
    expect(MIME_TYPES['.csv']).toBe('text/csv');
    expect(MIME_TYPES['.md']).toBe('text/markdown');
  });

  it('maps data format extensions', () => {
    expect(MIME_TYPES['.json']).toBe('application/json');
    expect(MIME_TYPES['.xml']).toBe('application/xml');
    expect(MIME_TYPES['.yaml']).toBe('text/yaml');
    expect(MIME_TYPES['.yml']).toBe('text/yaml');
  });

  it('maps binary extensions', () => {
    expect(MIME_TYPES['.pdf']).toBe('application/pdf');
    expect(MIME_TYPES['.zip']).toBe('application/zip');
    expect(MIME_TYPES['.gz']).toBe('application/gzip');
  });
});

describe('mimeFromPath', () => {
  it('resolves known extensions', () => {
    expect(mimeFromPath('screenshots/page.png')).toBe('image/png');
    expect(mimeFromPath('data/report.json')).toBe('application/json');
    expect(mimeFromPath('docs/readme.md')).toBe('text/markdown');
  });

  it('is case-insensitive via lowercase normalization', () => {
    expect(mimeFromPath('file.PNG')).toBe('image/png');
    expect(mimeFromPath('FILE.JSON')).toBe('application/json');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(mimeFromPath('archive.tar.bz2')).toBe('application/octet-stream');
    expect(mimeFromPath('binary.dat')).toBe('application/octet-stream');
  });

  it('returns octet-stream for files without extension', () => {
    expect(mimeFromPath('Makefile')).toBe('application/octet-stream');
    expect(mimeFromPath('data/noext')).toBe('application/octet-stream');
  });

  it('handles deeply nested paths', () => {
    expect(mimeFromPath('a/b/c/d/image.jpg')).toBe('image/jpeg');
  });

  it('uses the last extension for double-dotted files', () => {
    expect(mimeFromPath('archive.tar.gz')).toBe('application/gzip');
  });
});
