import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation', () => ({ getEscalation: vi.fn() }));

import * as escalationService from '../../services/escalation';
import { withOpen } from '../../api/scan-codes/open';
import { SCAN_OUTCOMES, type ScanExecuteResponse, type ScanOpen } from '../../types';

// Open is resolved on the server from the step and the answer: a row id to
// open (and maybe claim), or the facet values of a list read from the row.

const SUBJECT = { id: 'tub-row', role: 'transfer', metadata: { tubCode: 'T-1', route: 'A:B' } };
const LOCATED = { id: 'bag-row', role: 'matching', metadata: { orderId: 'O-9' } };

const ctx = (over: Record<string, unknown> = {}) => ({
  subject: { row: SUBJECT }, located: LOCATED, ...over,
}) as any;

const answer = (data: ScanExecuteResponse) => ({ status: 200, data });
const open = (o: ScanOpen) => ({ open: o });

beforeEach(() => vi.clearAllMocks());

describe('withOpen', () => {
  it('rides the held subject on a hold, so it stays while the row is held', async () => {
    const held = answer({
      outcome: SCAN_OUTCOMES.HELD, escalation: SUBJECT,
      subject: { code: '15:0:T-1', escalationId: 'tub-row', label: 'T-1', expiresAt: 'x' },
    });
    const result = await withOpen(held, open({ target: 'subject', claim: true }), ctx({ subject: undefined }));
    expect(result.data?.subject?.open).toEqual({ label: 'Open', escalationId: 'tub-row', claim: true });
    expect(result.data?.open).toBeUndefined();
  });

  it('a refusal opens the held subject', async () => {
    const result = await withOpen(answer({ outcome: SCAN_OUTCOMES.REFUSED, refusal: { markdown: 'No.' } }), open({ target: 'subject' }), ctx());
    expect(result.data?.open).toEqual({ label: 'Open', escalationId: 'tub-row' });
  });

  it('a refusal opens the scanned code\'s own row, with the step\'s label', async () => {
    const result = await withOpen(answer({ outcome: SCAN_OUTCOMES.REFUSED }), open({ target: 'located', label: 'Where it is' }), ctx());
    expect(result.data?.open).toEqual({ label: 'Where it is', escalationId: 'bag-row' });
  });

  it('a done screen lists the rows sharing facets with the row the step wrote, read from that row', async () => {
    vi.mocked(escalationService.getEscalation).mockResolvedValue(SUBJECT as any);
    const done = answer({ outcome: SCAN_OUTCOMES.EXECUTED, escalation: { id: 'tub-row', role: 'transfer' }, done: { markdown: 'In.' } });
    const result = await withOpen(done, open({ target: 'row', list: { facets: ['tubCode'], role: 'transfer' } }), ctx());
    expect(escalationService.getEscalation).toHaveBeenCalledWith('tub-row');
    expect(result.data?.open).toEqual({ label: 'Open', facets: { tubCode: 'T-1' }, role: 'transfer' });
  });

  it('a list facet the row does not carry offers no button', async () => {
    const result = await withOpen(answer({ outcome: SCAN_OUTCOMES.REFUSED }), open({ target: 'subject', list: { facets: ['binCode'] } }), ctx());
    expect(result.data?.open).toBeUndefined();
  });

  it('no row to open, or an answer the station does not show, leaves the answer as it was', async () => {
    const none = await withOpen(answer({ outcome: SCAN_OUTCOMES.REFUSED }), open({ target: 'located' }), ctx({ located: null }));
    expect(none.data?.open).toBeUndefined();
    const detail = answer({ outcome: SCAN_OUTCOMES.EXECUTED, escalation: { id: 'x', role: 'r' } as any });
    expect((await withOpen(detail, open({ target: 'row' }), ctx())).data?.open).toBeUndefined();
  });
});
