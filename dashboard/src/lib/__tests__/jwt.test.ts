import { describe, it, expect } from 'vitest';
import { decodeJwtPayload } from '../jwt';

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    // Create a simple JWT: header.payload.signature
    const payload = { userId: 'user-1', roles: [] };
    const encoded = btoa(JSON.stringify(payload));
    const token = `eyJ0eXAiOiJKV1QifQ.${encoded}.signature`;

    const result = decodeJwtPayload(token);
    expect(result).toEqual(payload);
  });

  it('returns null for malformed token (wrong part count)', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });

  it('returns null for invalid base64 payload', () => {
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
  });

  it('handles URL-safe base64 characters', () => {
    const payload = { test: true };
    // Manually create URL-safe base64
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const token = `header.${encoded}.sig`;

    const result = decodeJwtPayload(token);
    expect(result).toEqual(payload);
  });
});
