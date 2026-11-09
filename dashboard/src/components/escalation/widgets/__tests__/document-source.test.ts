import { describe, it, expect } from 'vitest';
import { DOCUMENT_KINDS, isLinkExpired, isSourceError, resolveDocumentSource } from '../document/document-source';

describe('resolveDocumentSource', () => {
  it('reads a signed file from the file domain', () => {
    const found = resolveDocumentSource('file.ref', '', {
      file: { ref: { url: 'https://s3.test/x', contentType: 'application/pdf', name: 'x.pdf', path: 'k/x.pdf', expiresAt: '2030-01-01T00:00:00Z' } },
    });
    expect(found).toEqual({
      url: 'https://s3.test/x', name: 'x.pdf', contentType: 'application/pdf', kind: DOCUMENT_KINDS.PDF,
      path: 'k/x.pdf', expiresAt: '2030-01-01T00:00:00Z',
    });
  });

  it('takes the first source that resolves', () => {
    const found = resolveDocumentSource(['file.missing', 'envelope.scan_url'], '', { envelope: { scan_url: 'https://cdn.test/a/scan.png' } });
    expect(found).toMatchObject({ kind: DOCUMENT_KINDS.IMAGE, name: 'scan.png' });
  });

  it('falls back to the field value when it is a link', () => {
    expect(resolveDocumentSource(undefined, 'https://cdn.test/doc.pdf', {})).toMatchObject({ kind: DOCUMENT_KINDS.PDF });
  });

  it('never loads a script-bearing or protocol-relative link', () => {
    expect(resolveDocumentSource(undefined, 'javascript:alert(1)', {})).toBeNull();
    expect(resolveDocumentSource(undefined, 'data:text/html,<script>', {})).toBeNull();
    expect(resolveDocumentSource(undefined, '//evil.test/x.pdf', {})).toBeNull();
    expect(resolveDocumentSource('file.ref', '', { file: { ref: { url: 'javascript:alert(1)' } } })).toBeNull();
  });

  it('passes a ref error through', () => {
    const found = resolveDocumentSource('file.ref', '', { file: { ref: { name: 'x.pdf', error: 'no signer' } } });
    expect(isSourceError(found)).toBe(true);
  });

  it('opens anything else as a plain file', () => {
    expect(resolveDocumentSource(undefined, 'https://cdn.test/a.zip', {})).toMatchObject({ kind: DOCUMENT_KINDS.FILE });
  });
});

describe('isLinkExpired', () => {
  it('lapses a few seconds early, and never without an expiry', () => {
    const now = Date.parse('2030-01-01T00:00:00Z');
    expect(isLinkExpired('2030-01-01T00:00:03Z', now)).toBe(true);
    expect(isLinkExpired('2030-01-01T00:01:00Z', now)).toBe(false);
    expect(isLinkExpired(undefined, now)).toBe(false);
  });
});
