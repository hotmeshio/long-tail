import jwt from 'jsonwebtoken';

import { config } from '../../modules/config';

/**
 * A browser's pass to the NATS WebSocket proxy, in place of the NATS server
 * credential. It names the person in `sub` and carries no `userId`, so it
 * authenticates nothing but the proxy upgrade.
 */
export const NATS_WS_TICKET_TYPE = 'nats-ws+jwt';
export const NATS_WS_TICKET_PARAM = 'ticket';
const TICKET_TTL_SECONDS = 24 * 60 * 60;

export function signNatsWsTicket(userId: string): string | null {
  if (!config.JWT_SECRET) return null;
  return jwt.sign({}, config.JWT_SECRET, {
    algorithm: 'HS256',
    header: { alg: 'HS256', typ: NATS_WS_TICKET_TYPE },
    subject: userId,
    expiresIn: TICKET_TTL_SECONDS,
  });
}

/** The person a valid ticket names; null for anything else. */
export function verifyNatsWsTicket(ticket: string | null | undefined): string | null {
  if (!ticket || !config.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(ticket, config.JWT_SECRET, { algorithms: ['HS256'], complete: true });
    if (decoded.header.typ !== NATS_WS_TICKET_TYPE) return null;
    const payload = decoded.payload as jwt.JwtPayload;
    return typeof payload.sub === 'string' && typeof payload.exp === 'number' ? payload.sub : null;
  } catch {
    return null;
  }
}
