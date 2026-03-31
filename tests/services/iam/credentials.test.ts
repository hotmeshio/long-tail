import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { resolveCredential } from '../../../services/iam/credentials';
import type { ToolPrincipal } from '../../../types/tool-context';

// Mock OAuth service
vi.mock('../../../services/oauth', () => ({
  getFreshAccessToken: vi.fn(async (userId: string, provider: string, label?: string) => {
    if (userId === 'user-with-token' && provider === 'anthropic') {
      return { accessToken: 'sk-ant-oat-user-token', refreshToken: null, expiresAt: null, scopes: [], provider: 'anthropic', label: label || 'default' };
    }
    throw new Error('No OAuth connection');
  }),
}));

const userPrincipal: ToolPrincipal = {
  id: 'user-with-token',
  type: 'user',
  roles: ['reviewer'],
};

const botPrincipal: ToolPrincipal = {
  id: 'bot-no-token',
  type: 'bot',
  roles: ['scheduler'],
};

describe('resolveCredential', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns user stored credential when available', async () => {
    const result = await resolveCredential(userPrincipal, 'anthropic');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('sk-ant-oat-user-token');
    expect(result!.source).toBe('user');
    expect(result!.type).toBe('oauth_token');
  });

  it('falls back to system env var when no stored credential', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-system-key';
    const result = await resolveCredential(botPrincipal, 'anthropic');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('sk-system-key');
    expect(result!.source).toBe('system');
    expect(result!.type).toBe('api_key');
  });

  it('tries CLAUDE_CODE_OAUTH_TOKEN as second anthropic env var', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-claude-code-token';
    delete process.env.ANTHROPIC_API_KEY;
    const result = await resolveCredential(botPrincipal, 'anthropic');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('sk-claude-code-token');
    expect(result!.source).toBe('system');
  });

  it('returns null when no credential available anywhere', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const result = await resolveCredential(botPrincipal, 'anthropic');
    expect(result).toBeNull();
  });

  it('returns null for unknown provider with no env vars', async () => {
    const result = await resolveCredential(userPrincipal, 'unknown-provider');
    expect(result).toBeNull();
  });

  it('resolves openai credential from env var', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-key';
    const result = await resolveCredential(botPrincipal, 'openai');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('sk-openai-key');
    expect(result!.source).toBe('system');
  });

  it('source reflects principal type (bot vs user)', async () => {
    const result = await resolveCredential(userPrincipal, 'anthropic');
    expect(result!.source).toBe('user');

    // Bot with no token falls back to env
    process.env.ANTHROPIC_API_KEY = 'sk-sys';
    const botResult = await resolveCredential(botPrincipal, 'anthropic');
    expect(botResult!.source).toBe('system');
  });
});
