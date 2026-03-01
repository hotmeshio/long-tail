/**
 * Generate a JWT token for the Long Tail dashboard.
 *
 * Usage:
 *   npx ts-node scripts/token.ts
 *   npx ts-node scripts/token.ts --userId admin --role superadmin
 *   npx ts-node scripts/token.ts --userId reviewer1 --roles reviewer,compliance
 *
 * Or via npm script:
 *   npm run token
 *   npm run token -- --userId admin --role superadmin
 */

import jwt from 'jsonwebtoken';

const args = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const userId = getArg('userId', 'admin');
const role = getArg('role', 'superadmin');
const rolesArg = getArg('roles', '');
const secret = process.env.JWT_SECRET || 'lt-dev-secret';
const expiresIn = getArg('expires', '7d');

// Build roles array for the dashboard auth context
const roleNames = rolesArg ? rolesArg.split(',') : [role];
const roles = roleNames.map((r) => ({
  role: r.trim(),
  type: r.trim() === 'superadmin' ? 'superadmin' : 'member',
}));

const payload = { userId, role, roles };
const token = jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);

console.log('\n  HotMesh Long Tail — Token Generator\n');
console.log('  Payload:', JSON.stringify(payload, null, 2));
console.log('  Expires:', expiresIn);
console.log('  Secret:', secret === 'lt-dev-secret' ? 'lt-dev-secret (default)' : '***');
console.log('\n  Token:\n');
console.log(`  ${token}\n`);
