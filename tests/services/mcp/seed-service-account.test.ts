import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A seeded service account's raw keys never reach the logger.
const mocks = vi.hoisted(() => ({
  getUserByExternalId: vi.fn(async () => null),
  createBot: vi.fn(async () => ({ id: 'bot-1' })),
  createBotKey: vi.fn(async (_id: string, name: string) => ({ rawKey: `lt_bot_${name}_secret` })),
  logged: [] as string[],
}));
vi.mock('../../../services/user/crud', () => ({ getUserByExternalId: mocks.getUserByExternalId }));
vi.mock('../../../services/iam', () => ({ createBot: mocks.createBot, createBotKey: mocks.createBotKey }));
vi.mock('../../../lib/logger', () => {
  const record = (message: string) => { mocks.logged.push(message); };
  return { loggerRegistry: { info: record, warn: record, error: record, debug: record } };
});

import { seedMcpServiceAccount } from '../../../services/mcp/seed-service-account';
import { config } from '../../../modules/config';

const saved = config.LT_SEED_SERVICE_KEYS;
let printed: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.logged.length = 0;
  printed = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { printed += String(chunk); return true; });
});
afterEach(() => {
  (config as any).LT_SEED_SERVICE_KEYS = saved;
  vi.restoreAllMocks();
});

describe('seedMcpServiceAccount', () => {
  it('with LT_SEED_SERVICE_KEYS, prints the keys to stdout and logs none', async () => {
    (config as any).LT_SEED_SERVICE_KEYS = true;
    await seedMcpServiceAccount();
    expect(printed).toContain('lt_bot_read_secret');
    expect(printed).toContain('lt_bot_full_secret');
    expect(mocks.logged.join('\n')).not.toContain('secret');
  });

  it('without it, creates the account with no keys', async () => {
    (config as any).LT_SEED_SERVICE_KEYS = false;
    await seedMcpServiceAccount();
    expect(mocks.createBot).toHaveBeenCalledOnce();
    expect(mocks.createBotKey).not.toHaveBeenCalled();
    expect(printed).toBe('');
  });

  it('an existing account is left alone', async () => {
    mocks.getUserByExternalId.mockResolvedValueOnce({ id: 'bot-1' } as any);
    await seedMcpServiceAccount();
    expect(mocks.createBot).not.toHaveBeenCalled();
  });
});
