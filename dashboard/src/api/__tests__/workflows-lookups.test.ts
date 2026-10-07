import { describe, it, expect } from 'vitest';
import { foldWorkflowLookups } from '../workflows';

describe('foldWorkflowLookups', () => {
  it('folds resolved lookups by as ?? key and skips missing ones', () => {
    expect(foldWorkflowLookups([
      { domain: 'c', key: 'materials', version: 3, current: true, as: 'mats', data: { items: [1] } },
      { domain: 'c', key: 'ghost', version: null, current: true, data: null, missing: true },
    ])).toEqual({ mats: { items: [1] } });
  });
});
