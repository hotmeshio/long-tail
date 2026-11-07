import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation', () => ({ searchByFacets: vi.fn() }));
vi.mock('../../services/role', () => ({ getRoleTitle: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({ getEscalationReadScope: vi.fn() }));

import * as escalationService from '../../services/escalation';
import { getRoleTitle } from '../../services/role';
import { getEscalationReadScope } from '../../api/escalations/helpers';
import * as scanCodeService from '../../services/scan-code';
import { loadLocated, readsLocated } from '../../api/scan-codes/located';
import { templateContext } from '../../api/scan-codes/context';
import type { ScanStep } from '../../types';

// {located.…}: where the scanned item is now, read only when a step's copy
// or Open asks for it.

const search = vi.mocked(escalationService.searchByFacets);
const BAG = { id: 'bag-row', role: 'matching', metadata: { orderId: 'O-9' } };
const HELD = { id: 'tub-row', role: 'transfer', metadata: {} };

const ctx = () => ({
  scheme: { version: 11, target_facet: 'orderSlug', target_match: 'value' },
  parsed: { version: 11, category: '0', target: 'K7Q2' },
  scannedAt: '2026-11-06T00:00:00Z',
  auth: { userId: 'mover' },
  subject: { row: HELD },
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEscalationReadScope).mockResolvedValue({ global: false, allRoles: ['matching', 'transfer'], selfRoles: [] } as any);
  vi.mocked(getRoleTitle).mockResolvedValue('Matching');
});

describe('readsLocated', () => {
  it('is true for copy that names {located.…}, or an Open on the located row', () => {
    expect(readsLocated({ refuse: { markdown: 'At {located.roleTitle}.' } } as ScanStep)).toBe(true);
    expect(readsLocated({ open: { target: 'located' } } as ScanStep)).toBe(true);
    expect(readsLocated({ refuse: { markdown: 'Wrong tub.' } } as ScanStep)).toBe(false);
  });
});

describe('loadLocated', () => {
  it('reads the newest pending row for the target in the reader\'s roles, never the held row', async () => {
    search.mockResolvedValue({ escalations: [HELD, BAG] } as any);
    const c = ctx();
    await loadLocated(c);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['matching', 'transfer'], facets: { orderSlug: 'K7Q2' }, status: 'pending',
      orderBy: [{ field: 'created_at', direction: 'desc' }],
    }), { total: false });
    expect(c.located).toBe(BAG);
    const copy = scanCodeService.renderScanCopy('This bag is at {located.roleTitle} ({located.orderId}).', templateContext(c));
    expect(copy).toBe('This bag is at Matching (O-9).');
  });

  it('reads once per request', async () => {
    search.mockResolvedValue({ escalations: [BAG] } as any);
    const c = ctx();
    await loadLocated(c);
    await loadLocated(c);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('a title-less role reads as its name; no row renders the token empty', async () => {
    vi.mocked(getRoleTitle).mockResolvedValue(null);
    search.mockResolvedValue({ escalations: [BAG] } as any);
    const c = ctx();
    await loadLocated(c);
    expect(templateContext(c).located?.roleTitle).toBe('matching');

    search.mockResolvedValue({ escalations: [] } as any);
    const none = ctx();
    await loadLocated(none);
    expect(none.located).toBeNull();
    expect(scanCodeService.renderScanCopy('At {located.roleTitle}.', templateContext(none))).toBe('At .');
  });

  it('a reader with no roles reads nothing', async () => {
    vi.mocked(getEscalationReadScope).mockResolvedValue({ global: false, allRoles: [], selfRoles: [] } as any);
    const c = ctx();
    await loadLocated(c);
    expect(search).not.toHaveBeenCalled();
    expect(c.located).toBeNull();
  });
});
