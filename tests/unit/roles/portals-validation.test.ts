import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/role', () => ({
  updateRoleMetadata: vi.fn(),
  listDistinctRoles: vi.fn(),
}));

import * as roleService from '../../../services/role';
import { updateRole } from '../../../api/roles';

const mockUpdate = vi.mocked(roleService.updateRoleMetadata);

const pin = (label: string) => ({ label, url: `/escalations/available?role=fleet&facets=${encodeURIComponent(`{"region":"${label}"}`)}`, badge: true });
const portal = (key: string, rows = [[pin('nw'), pin('ne')], [pin('sw'), pin('se')]], label = key) => ({ key, label, rows });

// A role's portals are named matrices of pin cells. The API bounds the list
// and each matrix and holds every cell to the pin contract before anything
// reaches the service.
describe('api/roles updateRole — portals validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ role: 'fleet' } as any);
  });

  it('accepts named portals and forwards them untouched', async () => {
    const portals = [portal('regions'), portal('focus', [[pin('jim'), pin('sally'), pin('anu'), pin('sai'), pin('tom')]], 'Focus of the day')];
    const result = await updateRole({ role: 'fleet', portals });
    expect(result.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('fleet', expect.objectContaining({ portals }));
  });

  it('accepts count tiles with optional blurbs and rejects malformed or too many', async () => {
    const counts = [{ label: 'Waiting', url: '/escalations/available?role=fleet', blurb: 'Unclaimed' }, { label: 'Done', url: '/escalations?status=resolved' }];
    expect((await updateRole({ role: 'fleet', portals: [{ ...portal('desk'), counts }] })).status).toBe(200);
    expect((await updateRole({ role: 'fleet', portals: [{ ...portal('desk'), counts: [{ label: 'x', url: 'https://elsewhere' }] }] })).status).toBe(400);
    expect((await updateRole({ role: 'fleet', portals: [{ ...portal('desk'), counts: [{ label: 'x', url: '/escalations', blurb: 3 }] }] as any })).status).toBe(400);
    expect((await updateRole({ role: 'fleet', portals: [{ ...portal('desk'), counts: Array.from({ length: 9 }, (_, i) => ({ label: `c${i}`, url: '/escalations' })) }] })).status).toBe(400);
  });

  it('accepts a single full-screen cell and ragged rows', async () => {
    expect((await updateRole({ role: 'fleet', portals: [portal('all', [[pin('all')]])] })).status).toBe(200);
    expect((await updateRole({ role: 'fleet', portals: [portal('mixed', [[pin('board')], [pin('n'), pin('s'), pin('harvest')]])] })).status).toBe(200);
  });

  it('null clears the portals', async () => {
    const result = await updateRole({ role: 'fleet', portals: null });
    expect(result.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('fleet', expect.objectContaining({ portals: null }));
  });

  it.each([
    ['no portals', []],
    ['a duplicate key', [portal('a'), portal('a')]],
    ['a key that is not a slug', [portal('Bad Key')]],
    ['a blank label', [portal('a', undefined, '  ')]],
    ['no rows', [portal('a', [])]],
    ['five rows', [portal('a', [[pin('a')], [pin('b')], [pin('c')], [pin('d')], [pin('e')]])]],
    ['an empty row', [portal('a', [[pin('a')], []])]],
    ['seven cells in a row', [portal('a', [['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(pin)])]],
    ['a non-relative url', [portal('a', [[{ label: 'x', url: 'https://elsewhere.test/' }]])]],
    ['a blank cell label', [portal('a', [[{ label: '  ', url: '/escalations' }]])]],
    ['a non-boolean badge', [portal('a', [[{ label: 'x', url: '/escalations', badge: 'yes' }]])]],
    ['rows that are not arrays', [{ key: 'a', label: 'a', rows: [pin('a')] }]],
  ])('rejects %s', async (_name, portals) => {
    const result = await updateRole({ role: 'fleet', portals: portals as any });
    expect(result.status).toBe(400);
    expect(result.error).toContain('portals');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
