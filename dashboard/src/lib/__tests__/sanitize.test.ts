import { describe, it, expect } from 'vitest';

import { sanitizeToolName, sanitizeServerName } from '../sanitize';

describe('sanitizeToolName', () => {
  it('lowercases and replaces non-alphanumeric with underscores', () => {
    expect(sanitizeToolName('Take-Screenshot')).toBe('take_screenshot');
    expect(sanitizeToolName('FOO.BAR')).toBe('foo_bar');
  });

  it('strips leading and trailing underscores', () => {
    expect(sanitizeToolName('--hello--')).toBe('hello');
    expect(sanitizeToolName('___test___')).toBe('test');
  });

  it('collapses consecutive special chars into a single underscore', () => {
    expect(sanitizeToolName('a---b...c')).toBe('a_b_c');
    expect(sanitizeToolName('one   two')).toBe('one_two');
  });
});

describe('sanitizeServerName', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(sanitizeServerName('My-Server')).toBe('myserver');
    expect(sanitizeServerName('FOO_BAR.baz')).toBe('foobarbaz');
  });

  it('strips leading digits', () => {
    expect(sanitizeServerName('123abc')).toBe('abc');
    expect(sanitizeServerName('0test')).toBe('test');
  });

  it('returns empty string for all-digit input', () => {
    expect(sanitizeServerName('12345')).toBe('');
  });

  it('handles empty string', () => {
    expect(sanitizeServerName('')).toBe('');
  });
});
