import { describe, it, expect } from 'vitest';

import {
  READ_SCOPES,
  WRITE_SCOPES,
  DEFAULT_READ_SCOPE,
  DEFAULT_WRITE_SCOPE,
  isValidReadScope,
  isValidWriteScope,
  isValidScopePair,
  effectiveScope,
} from '../../../services/user/scope';

describe('scope constants', () => {
  it('defaults preserve legacy member behavior (full worker)', () => {
    expect(DEFAULT_READ_SCOPE).toBe('all');
    expect(DEFAULT_WRITE_SCOPE).toBe('all');
  });

  it('enumerates the valid axis values', () => {
    expect(READ_SCOPES).toEqual(['self', 'all']);
    expect(WRITE_SCOPES).toEqual(['none', 'self', 'all']);
  });
});

describe('isValidReadScope / isValidWriteScope', () => {
  it('accepts valid values', () => {
    expect(isValidReadScope('self')).toBe(true);
    expect(isValidReadScope('all')).toBe(true);
    expect(isValidWriteScope('none')).toBe(true);
    expect(isValidWriteScope('self')).toBe(true);
    expect(isValidWriteScope('all')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidReadScope('none')).toBe(false); // read is always at least self
    expect(isValidReadScope('everything')).toBe(false);
    expect(isValidWriteScope('full')).toBe(false);
  });
});

describe('isValidScopePair (write ⊆ read)', () => {
  it('allows every point where write does not exceed read', () => {
    expect(isValidScopePair('self', 'none')).toBe(true);
    expect(isValidScopePair('self', 'self')).toBe(true);
    expect(isValidScopePair('all', 'none')).toBe(true);
    expect(isValidScopePair('all', 'self')).toBe(true); // chat app
    expect(isValidScopePair('all', 'all')).toBe(true);
  });

  it('rejects write_all under read_self (cannot act on what you cannot see)', () => {
    expect(isValidScopePair('self', 'all')).toBe(false);
  });
});

describe('effectiveScope', () => {
  it('returns a member’s stored scope verbatim', () => {
    expect(effectiveScope('member', 'self', 'self')).toEqual({ read: 'self', write: 'self' });
    expect(effectiveScope('member', 'all', 'self')).toEqual({ read: 'all', write: 'self' });
    expect(effectiveScope('member', 'all', 'none')).toEqual({ read: 'all', write: 'none' });
  });

  it('forces admin and superadmin to act on all, ignoring stored scope', () => {
    expect(effectiveScope('admin', 'self', 'none')).toEqual({ read: 'all', write: 'all' });
    expect(effectiveScope('superadmin', 'self', 'self')).toEqual({ read: 'all', write: 'all' });
  });
});
