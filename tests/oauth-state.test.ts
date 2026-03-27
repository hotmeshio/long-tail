import { describe, it, expect } from 'vitest';

import { createOAuthState, consumeOAuthState } from '../services/oauth/state';

describe('OAuth state management', () => {
  it('should create and consume state', () => {
    const { state, codeVerifier } = createOAuthState('google', '/dashboard');
    expect(state).toHaveLength(64); // 32 bytes hex
    expect(codeVerifier).toBeTruthy();

    const consumed = consumeOAuthState(state);
    expect(consumed).toBeTruthy();
    expect(consumed!.provider).toBe('google');
    expect(consumed!.returnTo).toBe('/dashboard');
    expect(consumed!.codeVerifier).toBe(codeVerifier);
  });

  it('should be single-use (consuming twice returns null)', () => {
    const { state } = createOAuthState('github', '/');
    expect(consumeOAuthState(state)).toBeTruthy();
    expect(consumeOAuthState(state)).toBeNull();
  });

  it('should return null for unknown state', () => {
    expect(consumeOAuthState('nonexistent-state-value')).toBeNull();
  });

  it('should generate unique states', () => {
    const a = createOAuthState('google', '/');
    const b = createOAuthState('google', '/');
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});
