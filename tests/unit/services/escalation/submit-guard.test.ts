import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearch = vi.fn();
vi.mock('../../../../services/escalation/queries', () => ({
  searchEscalationsFaceted: (...args: unknown[]) => mockSearch(...args),
}));

import { checkSubmitGuard } from '../../../../services/escalation/submit-guard';

const schemaWith = (guard: Record<string, unknown>) => ({ 'x-lt-submit-guard': guard });
const CTX = { escalation: {}, metadata: { walkId: 'walk-7' }, envelope: {}, payload: {} };

describe('checkSubmitGuard', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ escalations: [], total: 0 });
  });

  it('returns null when the schema declares no guard', async () => {
    expect(await checkSubmitGuard({}, CTX, 'u1')).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('blocks with the interpolated message while children remain, counting globally', async () => {
    mockSearch.mockResolvedValue({ escalations: [], total: 3 });
    const violation = await checkSubmitGuard(
      schemaWith({ query: { role: 'child', facets: { walkId: '{{metadata.walkId}}' } }, message: '{{count}} still open' }),
      CTX,
      'u1',
    );
    expect(violation).toEqual({ field: '_submitGuard', message: '3 still open' });
    const call = mockSearch.mock.calls[0][0];
    expect(call.global).toBe(true); // true child count, ignoring the resolver's read scope
    expect(call.facet.facets.walkId).toBe('walk-7'); // facet token interpolated
  });

  it('clears when the query is confirmed empty', async () => {
    const violation = await checkSubmitGuard(schemaWith({ query: { role: 'child' } }), CTX, 'u1');
    expect(violation).toBeNull();
  });

  it('self-skips (never queries) when the scope cannot be evaluated — assigned:me with no user', async () => {
    const violation = await checkSubmitGuard(schemaWith({ query: { role: 'child', assigned: 'me' } }), CTX, undefined);
    expect(violation).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('respects mustBeEmpty:false', async () => {
    const violation = await checkSubmitGuard(schemaWith({ query: { role: 'child' }, mustBeEmpty: false }), CTX, 'u1');
    expect(violation).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
