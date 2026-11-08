import { describe, it, expect } from 'vitest';

import { expandRangeSource, parseListSource, resolveLabelTargets } from '../../../services/labels/targets';
import { LabelRequestError } from '../../../services/labels/errors';

const action = { version: 14, kind: 'action', target_facet: 'itemKey', target_match: 'value' } as any;
const identity = { version: 11, kind: 'identity', target_facet: 'badge_id' } as any;
const auth = { userId: '00000000-0000-4000-8000-000000000001' };

describe('parseListSource', () => {
  it('reads one target per line', () => {
    expect(parseListSource('A-1\n\n A-2 \n')).toEqual([{ target: 'A-1', item: {} }, { target: 'A-2', item: {} }]);
  });

  it('a header row names the item columns', () => {
    expect(parseListSource('target,sub Title\nA-1,Acme')).toEqual([{ target: 'A-1', item: { sub_Title: 'Acme' } }]);
  });

  it('extra columns without a header are col2, col3', () => {
    expect(parseListSource('A-1\tAcme\tNorth')).toEqual([{ target: 'A-1', item: { col2: 'Acme', col3: 'North' } }]);
  });
});

describe('expandRangeSource', () => {
  it('pads and wraps a numeric run', () => {
    expect(expandRangeSource({ kind: 'range', prefix: 'B-', from: 1, to: 3, pad: 2 }, 100).map((t) => t.target))
      .toEqual(['B-01', 'B-02', 'B-03']);
  });

  it('refuses a backwards range, a huge pad, and a run past the cap', () => {
    expect(() => expandRangeSource({ kind: 'range', from: 5, to: 1 }, 100)).toThrow(LabelRequestError);
    expect(() => expandRangeSource({ kind: 'range', from: 1, to: 2, pad: 40 }, 100)).toThrow(/pad/);
    expect(() => expandRangeSource({ kind: 'range', from: 1, to: 500 }, 100)).toThrow(/at most 100/);
  });
});

describe('resolveLabelTargets source rules', () => {
  it('identity schemes read users only', async () => {
    await expect(resolveLabelTargets({ kind: 'list', text: 'TOKEN' }, identity, auth)).rejects.toThrow(/users source/);
    await expect(resolveLabelTargets({ kind: 'range', from: 1, to: 2 }, identity, auth)).rejects.toThrow(/users source/);
  });

  it('a users source prints identity labels only', async () => {
    await expect(resolveLabelTargets({ kind: 'users' }, action, auth)).rejects.toThrow(/identity labels only/);
  });

  it('an empty list names no targets', async () => {
    await expect(resolveLabelTargets({ kind: 'list', text: '\n' }, action, auth)).rejects.toThrow(/no targets/);
  });
});
