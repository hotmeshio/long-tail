import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../../../modules/sso', () => ({ getSSOConfig: () => null }));

import { signNatsWsTicket, verifyNatsWsTicket } from '../../../lib/events/nats-ws-ticket';
import { config } from '../../../modules/config';
import { requireAuth, signToken } from '../../../modules/auth';

// A ticket opens the NATS proxy and nothing else; nothing else opens the proxy.
const USER = '11111111-1111-4111-8111-111111111111';
let savedSecret: string;

beforeAll(() => { savedSecret = config.JWT_SECRET; (config as any).JWT_SECRET = 'ticket-secret'; });
afterAll(() => { (config as any).JWT_SECRET = savedSecret; });

describe('NATS WebSocket ticket', () => {
  it('names the person it was issued to', () => {
    expect(verifyNatsWsTicket(signNatsWsTicket(USER))).toBe(USER);
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
