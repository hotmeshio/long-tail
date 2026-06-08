import type { Request } from 'express';

import { getSSOConfig } from '../modules/sso';
import { ssoProvision } from '../services/user/sso-provision';
import { signToken } from '../modules/auth';
import type { LTApiResult } from '../types/sdk';

/**
 * Exchange host authentication for a Long Tail JWT.
 *
 * Calls `sso.resolve(req)` to extract the host identity, JIT provisions
 * the user in `lt_users`, and returns a signed JWT the dashboard can
 * store for subsequent API calls.
 *
 * No request body required — the host's cookies/headers carry the auth.
 */
export async function exchangeSSO(req: Request): Promise<LTApiResult> {
  try {
    const ssoConfig = getSSOConfig();
    if (!ssoConfig) {
      return { status: 404, error: 'SSO not configured' };
    }

    const identity = await ssoConfig.resolve(req);
    if (!identity) {
      return { status: 401, error: 'Host authentication required' };
    }

    const provisioned = await ssoProvision(identity, ssoConfig);

    const highestType = provisioned.roles.some((r) => r.type === 'superadmin')
      ? 'superadmin'
      : provisioned.roles.some((r) => r.type === 'admin')
        ? 'admin'
        : 'member';

    const token = signToken(
      {
        userId: provisioned.userId,
        role: highestType,
        roles: provisioned.roles,
        sso: true,
      },
      '24h',
    );

    return {
      status: 200,
      data: {
        token,
        user: {
          id: provisioned.userId,
          external_id: identity.externalId,
          display_name: identity.displayName || identity.externalId,
          roles: provisioned.roles,
        },
      },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
