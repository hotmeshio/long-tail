import { describe, it, expect, vi, beforeEach } from 'vitest';

// The workflow lookups endpoint: the refs on the config ARE the grant. Any
// caller the invoke gate admits reads exactly the pinned editions it names.

vi.mock('../../services/config', () => ({
  getWorkflowConfig: vi.fn(),
}));
vi.mock('../../services/user', () => ({
  getUser: vi.fn(),
}));
vi.mock('../../services/knowledge', () => ({
  resolveLookupRefs: vi.fn(),
}));

import { getWorkflowInputLookups } from '../../api/workflows/input-lookups';
import * as configService from '../../services/config';
import * as userService from '../../services/user';
import * as knowledgeService from '../../services/knowledge';

const mockGetConfig = vi.mocked(configService.getWorkflowConfig);
const mockGetUser = vi.mocked(userService.getUser);
const mockResolve = vi.mocked(knowledgeService.resolveLookupRefs);

const REFS = [{ domain: 'fleet', key: 'serial-numbers', version: 1, as: 'serials' }];
const RESOLVED = [{ ...REFS[0], data: { items: [{ value: 'sn-1', label: 'Printer 1' }] } }];
const config = (overrides: Record<string, unknown> = {}) => ({
  workflow_type: 'fleetTools',
  invocable: true,
  invocation_roles: ['printer-fleet'],
  input_lookups: REFS,
  ...overrides,
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(RESOLVED as any);
});

describe('getWorkflowInputLookups', () => {
  it('resolves the pinned refs for a caller holding an invocation role', async () => {
    mockGetConfig.mockResolvedValue(config());
    mockGetUser.mockResolvedValue({ roles: [{ role: 'printer-fleet', type: 'member' }] } as any);
    const result = await getWorkflowInputLookups({ type: 'fleetTools' }, { userId: 'u1', role: 'member' });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ lookups: RESOLVED });
    expect(mockResolve).toHaveBeenCalledWith(REFS);
  });

  it('a superadmin reads every workflow\'s lookups', async () => {
    mockGetConfig.mockResolvedValue(config());
    mockGetUser.mockResolvedValue({ roles: [] } as any);
    const result = await getWorkflowInputLookups({ type: 'fleetTools' }, { userId: 'u1', role: 'superadmin' });
    expect(result.status).toBe(200);
  });

  it('403s a caller the invoke gate refuses, with no knowledge read', async () => {
    mockGetConfig.mockResolvedValue(config());
    mockGetUser.mockResolvedValue({ roles: [{ role: 'viewer', type: 'member' }] } as any);
    const result = await getWorkflowInputLookups({ type: 'fleetTools' }, { userId: 'u1', role: 'member' });
    expect(result.status).toBe(403);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('403s when the workflow is not invocable', async () => {
    mockGetConfig.mockResolvedValue(config({ invocable: false, invocation_roles: [] }));
    mockGetUser.mockResolvedValue({ roles: [] } as any);
    const result = await getWorkflowInputLookups({ type: 'fleetTools' }, { userId: 'u1', role: 'member' });
    expect(result.status).toBe(403);
  });

  it('404s an unregistered workflow', async () => {
    mockGetConfig.mockResolvedValue(null);
    const result = await getWorkflowInputLookups({ type: 'ghost' }, { userId: 'u1', role: 'member' });
    expect(result.status).toBe(404);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('answers an empty list for a config without refs', async () => {
    mockGetConfig.mockResolvedValue(config({ input_lookups: null, invocation_roles: [] }));
    mockGetUser.mockResolvedValue({ roles: [] } as any);
    mockResolve.mockResolvedValue([]);
    const result = await getWorkflowInputLookups({ type: 'fleetTools' }, { userId: 'u1', role: 'member' });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ lookups: [] });
    expect(mockResolve).toHaveBeenCalledWith([]);
  });
});
