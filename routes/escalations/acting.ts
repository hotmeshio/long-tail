import type { Request, Response } from 'express';

import { resolveActingAuth } from '../../services/iam/acting-identity';
import type { LTApiAuth } from '../../types/sdk';

/** The header a shared station device rides its badge grant on. */
export const ACTING_TOKEN_HEADER = 'x-lt-acting-token';

/**
 * The effective actor for an escalation WORK verb (claim, release, resolve):
 * the badged person when an acting grant rides the request, otherwise the
 * authenticated principal. A supplied-but-dead grant answers 401 and returns
 * null — never a silent fall-back to the session identity, which would
 * misattribute the mutation. Read paths never consult this header.
 */
export async function effectiveWorkAuth(
  req: Request,
  res: Response,
): Promise<LTApiAuth | null> {
  const token = req.headers[ACTING_TOKEN_HEADER];
  if (!token || typeof token !== 'string') return req.auth!;
  const resolved = await resolveActingAuth(token);
  if (!resolved.ok) {
    res.status(401).json({ error: resolved.error });
    return null;
  }
  return resolved.auth;
}
