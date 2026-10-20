import { describe, it, expect } from 'vitest';

import { domainDictionarySource } from '../../../start/workers';
import type { DomainDictionary } from '../../../types';

const DICTIONARY: DomainDictionary = { name: 'floor', version: '1', overview: 'The floor', terms: [] };

describe('domainDictionarySource', () => {
  it('reads an inline dictionary', () => {
    expect(domainDictionarySource({ mcp: { domainDictionary: DICTIONARY } })).toBe(DICTIONARY);
  });

  it('reads a dictionary file path', () => {
    expect(domainDictionarySource({ mcp: { domainDictionaryPath: 'domain.json' } })).toBe('domain.json');
  });

  it('reads nothing when neither is declared', () => {
    expect(domainDictionarySource({})).toBeUndefined();
  });

  it('refuses both at once', () => {
    expect(() => domainDictionarySource({ mcp: { domainDictionary: DICTIONARY, domainDictionaryPath: 'domain.json' } }))
      .toThrow('mcp.domainDictionary and mcp.domainDictionaryPath are exclusive');
  });
});
