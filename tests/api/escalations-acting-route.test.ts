import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/iam/acting-identity', () => ({
  resolveActingAuth: vi.fn(),
}));

import { resolveActingAuth } from '../../services/iam/acting-identity';
import { effectiveWorkAuth, ACTING_TOKEN_HEADER } from '../../routes/escalations/acting';

const acting = vi.mocked(resolveActingAuth);

function reqRes(headers: Record<string, string> = {}) {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
  const req: any = { headers, auth: { userId: 'station-1' } };
  return { req, res };
}

beforeEach(() => vi.clearAllMocks());

describe('effectiveWorkAuth — the acting header on the work verbs', () => {
  it('without the header, the authenticated principal acts', async () => {
    const { req, res } = reqRes();
    expect(await effectiveWorkAuth(req, res)).toEqual({ userId: 'station-1' });
    expect(acting).not.toHaveBeenCalled();
  });

  it('a live grant swaps the actor to the badged person', async () => {
    acting.mockResolvedValue({ ok: true, auth: { userId: 'person-1' } });
    const { req, res } = reqRes({ [ACTING_TOKEN_HEADER]: 'eph:v1:acting_identity:x' });
    expect(await effectiveWorkAuth(req, res)).toEqual({ userId: 'person-1' });
  });

  it('a dead grant is a loud 401 — never a silent fall-back to the session', async () => {
    acting.mockResolvedValue({ ok: false, error: 'acting identity expired — scan your badge again' });
    const { req, res } = reqRes({ [ACTING_TOKEN_HEADER]: 'eph:v1:acting_identity:x' });
    expect(await effectiveWorkAuth(req, res)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('scan your badge');
  });
});
