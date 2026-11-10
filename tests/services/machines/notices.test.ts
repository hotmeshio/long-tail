import { describe, it, expect } from 'vitest';

import { ROW_TYPE, noticeSignalKey, rowWorkflowId } from '../../../services/machines/contracts';
import { noticeRow, readNoticeFacets, readParkedFacets, requestRef } from '../../../services/machines/requests';

describe('notice rows', () => {
  it('a notice row is keyed per machine message, holds no items, and is parked on the machine\'s role unless one is named', () => {
    const row = noticeRow('s1', 'l1', 'loader-1', 'm-9', { kind: 'material-removed', withinMs: 5_000 }, { message_name: 'input_material_removed', quantity: 10 });
    expect(row).toMatchObject({
      type: ROW_TYPE.MACHINE_NOTICE, subtype: 'material-removed', role: '',
      signal_key: noticeSignalKey('s1', 'l1', 'loader-1', 'm-9'), description: 'loader-1 reports: input_material_removed',
    });
    expect(row.accumulate).toBeUndefined();
    expect(row.metadata).toEqual({
      siteId: 's1', lineId: 'l1', machineId: 'loader-1', ref: 'm-9', kind: 'material-removed', withinMs: 5_000,
      event: { message_name: 'input_material_removed', quantity: 10 },
    });
    expect(noticeRow('s1', 'l1', 'loader-1', 'm-9', { role: 'material-desk' }, {})).toMatchObject({ role: 'material-desk', subtype: ROW_TYPE.MACHINE_NOTICE, description: 'loader-1 reports: a notice' });
  });

  it('a notice names its own ref first, like a request', () => {
    expect(requestRef({ notice: { ref: 'N' }, receiptId: 'C', body: { id: 'E' } as any })).toBe('N');
    expect(requestRef({ notice: {}, receiptId: 'C' })).toBe('C');
  });

  it('reads a notice row\'s facets, and a parked row\'s by its type', () => {
    const md = { siteId: 's1', lineId: 'l1', machineId: 'loader-1', ref: 'm-9', kind: 'material-removed', event: { quantity: 10 } };
    expect(readNoticeFacets(md)).toEqual(md);
    expect(readNoticeFacets({ ...md, ref: undefined })).toBeNull();
    expect(readParkedFacets(ROW_TYPE.MACHINE_NOTICE, md)).toEqual(md);
    expect(readParkedFacets(ROW_TYPE.MACHINE_REQUEST, md)).toBeNull();
    expect(readParkedFacets(ROW_TYPE.MACHINE_REQUEST, { ...md, op: 'ack' })).toMatchObject({ op: 'ack' });
    expect(readParkedFacets(ROW_TYPE.ALARM, md)).toBeNull();
  });

  it('a parked row\'s workflow id is its type and id', () => {
    expect(rowWorkflowId(ROW_TYPE.MACHINE_NOTICE, 'r-1')).toBe('machine-notice-r-1');
  });
});
