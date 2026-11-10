import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/identifiers', async (importActual) => {
  const actual = await importActual<typeof import('../../services/identifiers')>();
  return {
    ...actual,
    bindingScheme: vi.fn(), mayBind: vi.fn(), bind: vi.fn(), rebind: vi.fn(), retire: vi.fn(), listBindings: vi.fn(),
  };
});

import * as svc from '../../services/identifiers';
import { bindIdentifier, listIdentifierBindings, rebindIdentifier, retireIdentifierBinding } from '../../api/identifiers';

const AUTH = { userId: '00000000-0000-4000-8000-000000000001' };
const BINDING = { id: '1', scheme_version: 86, raw: 'CART-1', target: 'LOT-7' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.bindingScheme).mockResolvedValue({ version: 86, identifier: { binders: ['loader'] } } as any);
  vi.mocked(svc.mayBind).mockResolvedValue(true);
});

describe('identifier bindings API', () => {
  it('bind answers 201 when bound and 200 when the pair already stood, recording the caller and the api', async () => {
    vi.mocked(svc.bind).mockResolvedValueOnce({ binding: BINDING, already: false, retired: [] } as any);
    expect((await bindIdentifier({ scheme: 86, raw: 'CART-1', target: 'LOT-7' }, AUTH)).status).toBe(201);
    expect(svc.bind).toHaveBeenCalledWith(86, 'CART-1', 'LOT-7', { userId: AUTH.userId, via: 'api' });
    vi.mocked(svc.bind).mockResolvedValueOnce({ binding: BINDING, already: true, retired: [] } as any);
    expect((await bindIdentifier({ scheme: 86, raw: 'CART-1', target: 'LOT-7' }, AUTH)).status).toBe(200);
  });

  it('a caller who is neither a role manager nor a binder is refused 403, and nothing is written', async () => {
    vi.mocked(svc.mayBind).mockResolvedValue(false);
    expect((await bindIdentifier({ scheme: 86, raw: 'CART-1', target: 'LOT-7' }, AUTH)).status).toBe(403);
    expect((await rebindIdentifier({ scheme: 86, raw: 'CART-1', target: 'LOT-8' }, AUTH)).status).toBe(403);
    expect((await retireIdentifierBinding({ scheme: 86, id: '1' }, AUTH)).status).toBe(403);
    expect(svc.bind).not.toHaveBeenCalled();
    expect(svc.rebind).not.toHaveBeenCalled();
    expect(svc.retire).not.toHaveBeenCalled();
  });

  it('a value bound elsewhere answers the service\'s 409; an unknown scheme its 404', async () => {
    vi.mocked(svc.bind).mockRejectedValue(new svc.BindingError(409, 'this value is already bound under scheme 86'));
    expect(await bindIdentifier({ scheme: 86, raw: 'CART-1', target: 'LOT-8' }, AUTH)).toEqual({ status: 409, error: 'this value is already bound under scheme 86' });
    vi.mocked(svc.bindingScheme).mockRejectedValue(new svc.BindingError(404, 'scan scheme 55 does not exist'));
    expect((await listIdentifierBindings({ scheme: 55 })).status).toBe(404);
  });

  it('retire answers 404 for a binding that is not live', async () => {
    vi.mocked(svc.retire).mockResolvedValue(null);
    expect((await retireIdentifierBinding({ scheme: 86, id: '9' }, AUTH)).status).toBe(404);
  });

  it('list passes its filters through', async () => {
    vi.mocked(svc.listBindings).mockResolvedValue([BINDING] as any);
    const res = await listIdentifierBindings({ scheme: 86, raw: 'CART-1', includeRetired: true });
    expect(res).toEqual({ status: 200, data: { bindings: [BINDING] } });
    expect(svc.listBindings).toHaveBeenCalledWith(86, { raw: 'CART-1', includeRetired: true });
  });
});
