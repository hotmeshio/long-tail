import { describe, it, expect, vi, afterEach } from 'vitest';
import { decodeJwtPayload, getTokenExpiry, isTokenExpired } from '../jwt';

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

// ── Token helpers ─────────────────────────────────────────────────────────────

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesignature`;
}

describe('getTokenExpiry', () => {
  it('returns exp claim when present', () => {
    const token = makeToken({ userId: 'u1', exp: 1700000000 });
    expect(getTokenExpiry(token)).toBe(1700000000);
  });

  it('returns null when exp is missing', () => {
    const token = makeToken({ userId: 'u1' });
    expect(getTokenExpiry(token)).toBeNull();
  });

  it('returns null when exp is not a number', () => {
    const token = makeToken({ userId: 'u1', exp: 'not-a-number' });
    expect(getTokenExpiry(token)).toBeNull();
  });

  it('returns null for malformed token', () => {
    expect(getTokenExpiry('garbage')).toBeNull();
  });
});

describe('isTokenExpired', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for a token that expires in the future', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const token = makeToken({ userId: 'u1', exp: futureExp });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for a token that already expired', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    const token = makeToken({ userId: 'u1', exp: pastExp });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true when token expires within the buffer', () => {
    const soonExp = Math.floor(Date.now() / 1000) + 120; // 2 minutes from now
    const token = makeToken({ userId: 'u1', exp: soonExp });
    // With a 5-minute buffer, this token is "expired"
    expect(isTokenExpired(token, 300)).toBe(true);
  });

  it('returns false when token expires after the buffer', () => {
    const laterExp = Math.floor(Date.now() / 1000) + 600; // 10 minutes from now
    const token = makeToken({ userId: 'u1', exp: laterExp });
    // With a 5-minute buffer, still valid
    expect(isTokenExpired(token, 300)).toBe(false);
  });

  it('returns true for token without exp claim', () => {
    const token = makeToken({ userId: 'u1' });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true for garbage input', () => {
    expect(isTokenExpired('not-a-token')).toBe(true);
  });
});
