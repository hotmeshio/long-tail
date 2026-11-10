import { describe, it, expect } from 'vitest';

import { REQUEST_ITEM, ROW_TYPE, requestSignalKey } from '../../../services/machines/contracts';
import { answerItem, readAnswer, readRequestFacets, requestRef, requestRow } from '../../../services/machines/requests';

const ANSWER = { op: 'material-ack', withinMs: 30_000 };

describe('request rows', () => {
  it('a request row is keyed per machine message, opened for items, and parked on the machine\'s role unless one is named', () => {
    const row = requestRow('s1', 'l1', 'press-01', 'm-7', ANSWER, { message_name: 'material-received' });
    expect(row).toMatchObject({
      type: ROW_TYPE.MACHINE_REQUEST, subtype: 'material-ack', role: '', accumulate: {},
      signal_key: requestSignalKey('s1', 'l1', 'press-01', 'm-7'), description: 'press-01 asks: material-received',
    });
    expect(row.metadata).toEqual({ siteId: 's1', lineId: 'l1', machineId: 'press-01', op: 'material-ack', ref: 'm-7', withinMs: 30_000, event: { message_name: 'material-received' } });
    expect(requestRow('s1', 'l1', 'press-01', 'm-7', { op: 'x', role: 'loader' }, {}).role).toBe('loader');
  });

  it('the ref is the codec\'s, else the receipt id, else the envelope id', () => {
    expect(requestRef({ answer: { op: 'a', ref: 'R' }, receiptId: 'C', body: { id: 'E' } as any })).toBe('R');
    expect(requestRef({ answer: { op: 'a' }, receiptId: 'C', body: { id: 'E' } as any })).toBe('C');
    expect(requestRef({ answer: { op: 'a' }, body: { id: 'E' } as any })).toBe('E');
    expect(requestRef({ answer: { op: 'a' }, body: null })).toBeNull();
  });

  it('facets read back from the row; a row missing its machine, op or ref is not a request', () => {
    const { metadata } = requestRow('s1', 'l1', 'press-01', 'm-7', { op: 'a' }, {});
    expect(readRequestFacets(metadata)).toEqual({ siteId: 's1', lineId: 'l1', machineId: 'press-01', op: 'a', ref: 'm-7', event: {} });
    expect(readRequestFacets({ ...metadata, ref: '' })).toBeNull();
  });

  it('an answer item round-trips, and a row without one holds no answer', () => {
    const item = answerItem({ accepted: true }, 'reject-material');
    expect(item.itemKey).toBe(REQUEST_ITEM.ANSWER);
    expect(readAnswer([{ ...item, actor: 'bot-1' }])).toEqual({ args: { accepted: true }, op: 'reject-material', actor: 'bot-1' });
    expect(readAnswer([{ itemKey: 'other', payload: {} }])).toBeNull();
    expect(readAnswer([{ itemKey: REQUEST_ITEM.ANSWER, payload: { args: 'bad' } }])).toEqual({ args: {} });
  });
});
