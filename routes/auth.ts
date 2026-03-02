import { Router } from 'express';

import { verifyPassword } from '../services/user';
import { signToken } from '../modules/auth';

const router = Router();

/**
 * POST /api/auth/login
 * Authenticate with username (external_id) and password.
 * Returns a JWT token on success.
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const user = await verifyPassword(username, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
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

    res.json({
      token,
      user: {
        id: user.id,
        external_id: user.external_id,
        display_name: user.display_name,
        roles: user.roles,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
