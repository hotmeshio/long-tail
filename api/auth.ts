import { verifyPassword } from '../services/user';
import { signToken } from '../modules/auth';
import type { LTApiResult } from '../types/sdk';

/**
 * Authenticate a user by username and password.
 *
 * Verifies credentials against the user store and returns a signed JWT
 * with the user's roles and highest privilege level. The token is valid
 * for 24 hours.
 *
 * @param input.username — login identifier (external_id)
 * @param input.password — plaintext password
 * @returns `{ status: 200, data: { token, user: { id, external_id, display_name, roles } } }`
 */
export async function login(input: {
  username: string;
  password: string;
}): Promise<LTApiResult> {
  try {
    const { username, password } = input;
    if (!username || !password) {
      return { status: 400, error: 'username and password are required' };
    }

    const user = await verifyPassword(username, password);
    if (!user) {
      return { status: 401, error: 'Invalid credentials' };
    }

    const highestType = user.roles.some((r) => r.type === 'superadmin')
      ? 'superadmin'
      : user.roles.some((r) => r.type === 'admin')
        ? 'admin'
        : 'member';

    const token = signToken(
      {
        userId: user.id,
        role: highestType,
        roles: user.roles.map((r) => ({ role: r.role, type: r.type })),
      },
      '24h',
    );

    return {
      status: 200,
      data: {
        token,
        user: {
          id: user.id,
          external_id: user.external_id,
          display_name: user.display_name,
          roles: user.roles,
        },
      },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
