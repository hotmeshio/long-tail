import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg pool
const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// Mock bcrypt to avoid slow hashing in tests
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (pw: string) => `hashed:${pw}`),
    compare: vi.fn(),
  },
}));

import { createUser, updateUser } from '../../../services/user/crud';

describe('createUser — password passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashes password and passes to INSERT', async () => {
    const fakeUser = { id: 'u1', external_id: 'bob' };
    mockQuery.mockResolvedValue({ rows: [fakeUser] });

    await createUser({
      external_id: 'bob',
      password: 'my-secret',
    });

    // INSERT_USER query is the first call
    const insertCall = mockQuery.mock.calls[0];
    const params = insertCall[1];
    // password_hash is the 6th param (external_id, email, display_name, status, metadata, password_hash, oauth_provider, oauth_provider_id)
    expect(params[5]).toBe('hashed:my-secret');
  });

  it('passes null password_hash when password is omitted', async () => {
    const fakeUser = { id: 'u2', external_id: 'alice' };
    mockQuery.mockResolvedValue({ rows: [fakeUser] });

    await createUser({ external_id: 'alice' });

    const insertCall = mockQuery.mock.calls[0];
    const params = insertCall[1];
    expect(params[5]).toBeNull();
  });
});

describe('updateUser — password change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes password_hash in UPDATE when password is provided', async () => {
    const fakeUser = { id: 'u1', external_id: 'bob' };
    // First call: UPDATE, second call: roles query
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeUser] })
      .mockResolvedValueOnce({ rows: [] });

    await updateUser('u1', { password: 'new-pass' });

    const updateCall = mockQuery.mock.calls[0];
    const sql = updateCall[0] as string;
    const params = updateCall[1];
    expect(sql).toContain('password_hash');
    expect(params).toContain('hashed:new-pass');
  });

  it('does not include password_hash when password is not provided', async () => {
    const fakeUser = { id: 'u1', external_id: 'bob' };
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeUser] })
      .mockResolvedValueOnce({ rows: [] });

    await updateUser('u1', { display_name: 'Bob Updated' });

    const updateCall = mockQuery.mock.calls[0];
    const sql = updateCall[0] as string;
    expect(sql).not.toContain('password_hash');
  });

  it('can update password alongside other fields', async () => {
    const fakeUser = { id: 'u1', external_id: 'bob' };
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeUser] })
      .mockResolvedValueOnce({ rows: [] });

    await updateUser('u1', {
      display_name: 'Bob New',
      password: 'changed',
      email: 'bob@new.com',
    });

    const updateCall = mockQuery.mock.calls[0];
    const sql = updateCall[0] as string;
    const params = updateCall[1];
    expect(sql).toContain('password_hash');
    expect(sql).toContain('display_name');
    expect(sql).toContain('email');
    expect(params).toContain('hashed:changed');
    expect(params).toContain('Bob New');
    expect(params).toContain('bob@new.com');
  });
});
