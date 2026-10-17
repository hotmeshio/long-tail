import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

import { getPool } from '../db';
import { config } from '../../modules/config';

/**
 * A browser's pass to the NATS WebSocket proxy, in place of the NATS server
 * credential. It names the person in `sub` and carries no `userId`, so it
 * authenticates nothing but the proxy upgrade. Each ticket admits one
 * upgrade: the dashboard fetches a fresh one for every connection attempt.
 */
export const NATS_WS_TICKET_TYPE = 'nats-ws+jwt';
export const NATS_WS_TICKET_PARAM = 'ticket';

export interface NatsWsTicket {
  userId: string;
  jti: string;
  /** Expiry, in seconds since the epoch. */
  exp: number;
}

/** Record the ticket as spent, and drop expired records. True only for its first use. */
const SPEND_TICKET = `
  WITH expired AS (
    DELETE FROM lt_nats_ws_tickets WHERE expires_at < NOW()
  )
  INSERT INTO lt_nats_ws_tickets (jti, expires_at)
  VALUES ($1, to_timestamp($2))
  ON CONFLICT (jti) DO NOTHING
  RETURNING jti`;

export function signNatsWsTicket(userId: string): string | null {
  if (!config.JWT_SECRET) return null;
  return jwt.sign({}, config.JWT_SECRET, {
    algorithm: 'HS256',
    header: { alg: 'HS256', typ: NATS_WS_TICKET_TYPE },
    subject: userId,
    jwtid: randomUUID(),
    expiresIn: config.NATS_WS_TICKET_TTL_SECONDS,
  });
}

/** The claims of a valid ticket; null for anything else. Does not spend it. */
export function verifyNatsWsTicket(ticket: string | null | undefined): NatsWsTicket | null {
  if (!ticket || !config.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(ticket, config.JWT_SECRET, { algorithms: ['HS256'], complete: true });
    if (decoded.header.typ !== NATS_WS_TICKET_TYPE) return null;
    const { sub, jti, exp } = decoded.payload as jwt.JwtPayload;
    if (typeof sub !== 'string' || typeof jti !== 'string' || typeof exp !== 'number') return null;
    return { userId: sub, jti, exp };
  } catch {
    return null;
  }
}

/** Spend a verified ticket. False when it was already spent. */
export async function spendNatsWsTicket(ticket: NatsWsTicket): Promise<boolean> {
  const { rowCount } = await getPool().query(SPEND_TICKET, [ticket.jti, ticket.exp]);
  return rowCount === 1;
}
