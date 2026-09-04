import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { configureSearch, getSearchConfig } from '../../modules/search';

const ENV_KEYS = ['LT_SEARCH_BAR', 'LT_SEARCH_FACETS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  configureSearch();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('search config module', () => {
  it('defaults to disabled with no facets', () => {
    expect(getSearchConfig()).toEqual({ enabled: false, facets: [] });
  });

  it('applies the start-config block', () => {
    configureSearch({ enabled: true, facets: ['orderId', 'workbenchId'] });
    expect(getSearchConfig()).toEqual({ enabled: true, facets: ['orderId', 'workbenchId'] });
  });

  it('drops invalid facet names and dedupes', () => {
    configureSearch({ enabled: true, facets: ['orderId', 'bad key!', 'orderId', ' po '] });
    expect(getSearchConfig().facets).toEqual(['orderId', 'po']);
  });

  it('env enables the bar over a disabled config', () => {
    process.env.LT_SEARCH_BAR = 'true';
    configureSearch({ enabled: false });
    expect(getSearchConfig().enabled).toBe(true);
  });

  it('env disables the bar over an enabled config', () => {
    process.env.LT_SEARCH_BAR = 'false';
    configureSearch({ enabled: true });
    expect(getSearchConfig().enabled).toBe(false);
  });

  it('env facet csv replaces the configured list', () => {
    process.env.LT_SEARCH_FACETS = 'po, orderId ,nope key';
    configureSearch({ facets: ['workbenchId'] });
    expect(getSearchConfig().facets).toEqual(['po', 'orderId']);
  });

  it('getSearchConfig returns copies — callers cannot mutate the config', () => {
    configureSearch({ enabled: true, facets: ['orderId'] });
    getSearchConfig().facets.push('injected');
    expect(getSearchConfig().facets).toEqual(['orderId']);
  });
});
