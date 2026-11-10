import { describe, it, expect, afterEach } from 'vitest';

import { checkItem, registerItemCheck, unregisterItemCheck, type ItemCheck } from '../../../services/escalation/item-checks';

const row = (type: string) => ({ id: 'r-1', type, metadata: {} }) as any;
const refuseAnswers: ItemCheck = (_row, itemKey) => (itemKey === 'answer' ? 'the line cannot send it' : null);

afterEach(() => unregisterItemCheck('machine-request'));

describe('item checks', () => {
  it('a row type with no check accepts every item', async () => {
    expect(await checkItem(row('order'), 'answer', { args: {} })).toBeNull();
  });

  it('a registered check refuses with its reason, and accepts what it allows', async () => {
    registerItemCheck('machine-request', refuseAnswers);
    expect(await checkItem(row('machine-request'), 'answer', { args: {} })).toBe('the line cannot send it');
    expect(await checkItem(row('machine-request'), 'note', {})).toBeNull();
    expect(await checkItem(row('order'), 'answer', {})).toBeNull();
  });

  it('an async check is awaited', async () => {
    registerItemCheck('machine-request', async () => 'later');
    expect(await checkItem(row('machine-request'), 'answer', undefined)).toBe('later');
  });

  it('unregistering with a stale check leaves the current one in place', async () => {
    registerItemCheck('machine-request', refuseAnswers);
    unregisterItemCheck('machine-request', async () => null);
    expect(await checkItem(row('machine-request'), 'answer', {})).toBe('the line cannot send it');
    unregisterItemCheck('machine-request', refuseAnswers);
    expect(await checkItem(row('machine-request'), 'answer', {})).toBeNull();
  });
});
