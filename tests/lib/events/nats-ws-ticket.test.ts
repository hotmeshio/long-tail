import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

const spent = new Set<string>();
vi.mock('../../../modules/sso', () => ({ getSSOConfig: () => null }));
vi.mock('../../../lib/db', () => ({
  getPool: () => ({
    query: async (_sql: string, [jti]: [string]) => {
      if (spent.has(jti)) return { rowCount: 0, rows: [] };
      spent.add(jti);
      return { rowCount: 1, rows: [{ jti }] };
    },
  }),
}));

import { signNatsWsTicket, spendNatsWsTicket, verifyNatsWsTicket } from '../../../lib/events/nats-ws-ticket';
import { config } from '../../../modules/config';
import { requireAuth, signToken } from '../../../modules/auth';

// A ticket opens the NATS proxy and nothing else; nothing else opens the proxy.
const USER = '11111111-1111-4111-8111-111111111111';
let savedSecret: string;

beforeAll(() => { savedSecret = config.JWT_SECRET; (config as any).JWT_SECRET = 'ticket-secret'; });
afterAll(() => { (config as any).JWT_SECRET = savedSecret; });

describe('NATS WebSocket ticket', () => {
  it('names the person it was issued to, with a ticket id of its own', () => {
    const first = verifyNatsWsTicket(signNatsWsTicket(USER));
    const second = verifyNatsWsTicket(signNatsWsTicket(USER));
    expect(first?.userId).toBe(USER);
    expect(first?.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.jti).not.toBe(second?.jti);
  });

  it('is spent by its first use and refused after', async () => {
    const ticket = verifyNatsWsTicket(signNatsWsTicket(USER))!;
    expect(await spendNatsWsTicket(ticket)).toBe(true);
    expect(await spendNatsWsTicket(ticket)).toBe(false);
  });

  it('a ticket without an id is refused', () => {
    const noId = jwt.sign({}, 'ticket-secret', {
      algorithm: 'HS256', header: { alg: 'HS256', typ: 'nats-ws+jwt' }, subject: USER, expiresIn: 60,
    });
    expect(verifyNatsWsTicket(noId)).toBeNull();
  });

  it('lives as long as NATS_WS_TICKET_TTL_SECONDS, five minutes by default', () => {
    const { iat, exp } = jwt.decode(signNatsWsTicket(USER)!) as { iat: number; exp: number };
    expect(exp - iat).toBe(config.NATS_WS_TICKET_TTL_SECONDS);
    expect(config.NATS_WS_TICKET_TTL_SECONDS).toBe(300);
  });

  it('an expired ticket is refused', () => {
    const expired = jwt.sign({}, 'ticket-secret', {
      algorithm: 'HS256', header: { alg: 'HS256', typ: 'nats-ws+jwt' }, subject: USER, jwtid: 'j1', expiresIn: -1,
    });
    expect(verifyNatsWsTicket(expired)).toBeNull();
  });

  it('a session token is not a ticket', () => {
    expect(verifyNatsWsTicket(signToken({ userId: USER, role: 'member' }))).toBeNull();
    expect(verifyNatsWsTicket('garbage')).toBeNull();
    expect(verifyNatsWsTicket(undefined)).toBeNull();
  });

  it('requireAuth refuses a ticket', async () => {
    let outcome = 'no response';
    const res = {
      status(code: number) { this.code = code; return this; },
      json(body: { error: string }) { outcome = `${this.code} ${body.error}`; },
    } as any;
    await requireAuth({ headers: { authorization: `Bearer ${signNatsWsTicket(USER)}` } } as any, res, () => { outcome = 'next'; });
    expect(outcome).toBe('401 Token missing required userId claim');
  });
});
