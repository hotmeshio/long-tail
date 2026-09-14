import { describe, it, expect, beforeEach } from 'vitest';
import {
  SEARCH_MODE_KEY,
  buildCommandCode,
  buildSearchTarget,
  commandPrefix,
  loadSearchModeRef,
  modePlaceholder,
  resolveSearchMode,
  saveSearchModeRef,
  toScanCommand,
  type ScanCommand,
} from '../search-command';
import type { ScanRule, ScanScheme } from '../../api/scan-codes';

const delimited: ScanCommand = {
  version: 10, category: '1', name: 'Collect Print', schemeName: 'Printer serial',
  targetFacet: 'serialNumber', encoding: 'delimited', delimiter: ':', targetLength: null,
};
const fixed: ScanCommand = { ...delimited, version: 12, category: '0', name: 'Locate', encoding: 'fixed', targetLength: 8 };

beforeEach(() => localStorage.clear());

describe('commandPrefix / buildCommandCode', () => {
  it('delimited: version, category, and delimiters ahead of the target', () => {
    expect(commandPrefix(delimited)).toBe('10:1:');
    expect(buildCommandCode(delimited, 'SN-9')).toEqual({ code: '10:1:SN-9' });
  });

  it('delimited: a pasted whole code runs as-is', () => {
    expect(buildCommandCode(delimited, '10:3:SN-9')).toEqual({ code: '10:3:SN-9' });
  });

  it('fixed: digits concatenate with no delimiter', () => {
    expect(commandPrefix(fixed)).toBe('120');
    expect(buildCommandCode(fixed, '75949975')).toEqual({ code: '12075949975' });
  });

  it('fixed: accepts a trailing check digit', () => {
    expect(buildCommandCode(fixed, '759499759')).toEqual({ code: '120759499759' });
  });

  it('fixed: refuses letters and wrong lengths with the rule named', () => {
    expect(buildCommandCode(fixed, 'SN-9')).toEqual({ error: 'Locate takes digits only' });
    expect(buildCommandCode(fixed, '123')).toEqual({ error: 'Locate takes 8 digits' });
  });
});

describe('buildSearchTarget', () => {
  it('routes a metadata facet to the all-status table', () => {
    const url = buildSearchTarget('orderId', 'order-9')!;
    expect(url).toContain('/escalations/available');
    expect(url).toContain('status=all');
    expect(url).toContain(encodeURIComponent(JSON.stringify({ orderId: 'order-9' })));
  });

  it('defers built-in facets to a lookup', () => {
    expect(buildSearchTarget('escalationId', 'x')).toBeNull();
    expect(buildSearchTarget('workflowId', 'x')).toBeNull();
  });
});

describe('resolveSearchMode', () => {
  const facets = ['escalationId', 'workflowId', 'po'];

  it('honors a pinned facet or command that is still offered', () => {
    expect(resolveSearchMode({ kind: 'facet', facet: 'po' }, facets, [delimited]))
      .toEqual({ kind: 'facet', facet: 'po' });
    expect(resolveSearchMode({ kind: 'command', version: 10, category: '1' }, facets, [delimited]))
      .toEqual({ kind: 'command', command: delimited });
  });

  it('falls back to the first facet, then the first command, then null', () => {
    expect(resolveSearchMode({ kind: 'facet', facet: 'gone' }, facets, [])).toEqual({ kind: 'facet', facet: 'escalationId' });
    expect(resolveSearchMode(null, [], [delimited, fixed])).toEqual({ kind: 'command', command: delimited });
    expect(resolveSearchMode(null, [], [])).toBeNull();
  });
});

describe('mode persistence', () => {
  it('round-trips a pin', () => {
    saveSearchModeRef({ kind: 'command', version: 10, category: '1' });
    expect(JSON.parse(localStorage.getItem(SEARCH_MODE_KEY)!)).toEqual({ kind: 'command', version: 10, category: '1' });
    expect(loadSearchModeRef()).toEqual({ kind: 'command', version: 10, category: '1' });
  });

  it('reads the legacy facet key when no pin exists', () => {
    localStorage.setItem('lt:search:facet', 'po');
    expect(loadSearchModeRef()).toEqual({ kind: 'facet', facet: 'po' });
  });

  it('ignores malformed pins', () => {
    localStorage.setItem(SEARCH_MODE_KEY, '{"kind":"command"}');
    expect(loadSearchModeRef()).toBeNull();
  });
});

describe('placeholders and flattening', () => {
  it('names the value each mode expects', () => {
    expect(modePlaceholder({ kind: 'facet', facet: 'escalationId' })).toBe('Escalation id');
    expect(modePlaceholder({ kind: 'facet', facet: 'workflowId' })).toBe('Workflow id');
    expect(modePlaceholder({ kind: 'facet', facet: 'po' })).toBe('po');
    expect(modePlaceholder({ kind: 'command', command: delimited })).toBe('serialNumber');
  });

  it('flattens a scheme and rule into a command', () => {
    const scheme = {
      version: 10, name: 'Printer serial', target_facet: 'serialNumber', encoding: 'delimited',
      delimiter: ':', target_length: null,
    } as ScanScheme;
    const rule = { category: '1', name: 'Collect Print' } as ScanRule;
    expect(toScanCommand(scheme, rule)).toEqual(delimited);
  });
});
