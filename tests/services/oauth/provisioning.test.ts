import { describe, it, expect } from 'vitest';

import { normalizeDomains, emailDomain, mayProvision } from '../../../services/oauth/provisioning';

describe('OAuth provisioning domain filter', () => {
  describe('normalizeDomains', () => {
    it('lowercases, trims, strips a leading @ and drops blanks', () => {
      expect(normalizeDomains([' Example.COM ', '@other.org', '', '  '])).toEqual(['example.com', 'other.org']);
    });

    it('treats undefined as an empty list', () => {
      expect(normalizeDomains(undefined)).toEqual([]);
    });
  });

  describe('emailDomain', () => {
    it('returns the part after the last @, lowercased', () => {
      expect(emailDomain('A.User@Example.COM')).toBe('example.com');
      expect(emailDomain('"odd@local"@example.com')).toBe('example.com');
    });

    it('returns undefined without an @ or an email', () => {
      expect(emailDomain('nobody')).toBeUndefined();
      expect(emailDomain('@example.com')).toBeUndefined();
      expect(emailDomain(undefined)).toBeUndefined();
      expect(emailDomain(null)).toBeUndefined();
    });
  });

  describe('mayProvision', () => {
    it('admits any email, and no email, when no list is set', () => {
      expect(mayProvision('a@anywhere.io', [])).toBe(true);
      expect(mayProvision(undefined, [])).toBe(true);
    });

    it('admits an email whose domain is listed, regardless of case', () => {
      expect(mayProvision('a@Example.com', ['example.com'])).toBe(true);
    });

    it('refuses an email outside the list', () => {
      expect(mayProvision('a@elsewhere.com', ['example.com'])).toBe(false);
    });

    it('does not match subdomains implicitly', () => {
      expect(mayProvision('a@x.example.com', ['example.com'])).toBe(false);
      expect(mayProvision('a@x.example.com', ['example.com', 'x.example.com'])).toBe(true);
    });

    it('refuses a sign-in with no email when a list is set', () => {
      expect(mayProvision(undefined, ['example.com'])).toBe(false);
      expect(mayProvision(null, ['example.com'])).toBe(false);
    });
  });
});
