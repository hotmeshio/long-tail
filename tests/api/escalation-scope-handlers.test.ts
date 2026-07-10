import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Handler-level wiring: proves the by-id verbs (claim, resolve, cancel, release,
 * escalate, create, view) actually consult the scope gate and skip the mutation
 * on denial. The gate's decision table is exhaustively covered in
 * escalation-scope-matrix.test.ts; here we pin that each handler is wired to it.
 */

vi.mock('../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../services/user')>();
  return {
    ...actual,
    hasGlobalEscalationAccess: vi.fn(),
    getRoleScope: vi.fn(),
    getUserRoles: vi.fn(),
  };
});
vi.mock('../../services/escalation');
vi.mock('../../services/role', () => ({
  canEscalateTo: vi.fn(),
  getRoleMetadataSchema: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../services/task', () => ({ createTask: vi.fn(), getTask: vi.fn() }));
vi.mock('../../services/escalation-strategy', () => ({ escalationStrategyRegistry: { current: null } }));
vi.mock('../../services/iam/ephemeral', () => ({ storeEphemeral: vi.fn(), formatEphemeralToken: vi.fn() }));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../workers', () => ({ createClient: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));

import * as escalationService from '../../services/escalation';
import * as roleService from '../../services/role';
import * as userService from '../../services/user';
import { claimEscalation, releaseEscalation } from '../../api/escalations/claim';
import { cancelSingleEscalation } from '../../api/escalations/cancel';
import { resolveEscalation } from '../../api/escalations/resolve';
import { getEscalation, escalateToRole } from '../../api/escalations/single';
import { createEscalation } from '../../api/escalations/create';
import type { LTReadScope, LTWriteScope } from '../../types';

const mockGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockRoleScope = vi.mocked(userService.getRoleScope);
const svc = vi.mocked(escalationService);
const AUTH = { userId: 'me' };

const scope = (read: LTReadScope, write: LTWriteScope) => mockRoleScope.mockResolvedValue({ read, write });
const esc = (assigned_to: string | null) => ({
  id: 'esc-1', role: 'reviewer', status: 'pending', assigned_to,
  // notification-only resolve path (no workflow_type/task_queue, no signal metadata)
  workflow_type: undefined, task_queue: undefined, metadata: {}, envelope: undefined,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobal.mockResolvedValue(false);
  svc.getEscalation.mockResolvedValue(esc('me') as any);
});

describe('claim — write gate', () => {
  it('write_all claims any item', async () => {
    scope('all', 'all');
    svc.getEscalation.mockResolvedValue(esc('someone-else') as any);
    svc.claimEscalation.mockResolvedValue({ escalation: {}, isExtension: false } as any);
    expect((await claimEscalation({ id: 'esc-1' }, AUTH)).status).toBe(200);
    expect(svc.claimEscalation).toHaveBeenCalled();
  });

  it('write_self claims own (extension), denies others', async () => {
    scope('all', 'self');
    svc.claimEscalation.mockResolvedValue({ escalation: {}, isExtension: true } as any);
    expect((await claimEscalation({ id: 'esc-1' }, AUTH)).status).toBe(200);

    vi.clearAllMocks(); mockGlobal.mockResolvedValue(false); scope('all', 'self');
    svc.getEscalation.mockResolvedValue(esc('someone-else') as any);
    expect((await claimEscalation({ id: 'esc-1' }, AUTH)).status).toBe(403);
    expect(svc.claimEscalation).not.toHaveBeenCalled();
  });

  it('write_none (read-only) cannot claim', async () => {
    scope('all', 'none');
    expect((await claimEscalation({ id: 'esc-1' }, AUTH)).status).toBe(403);
    expect(svc.claimEscalation).not.toHaveBeenCalled();
  });

  it('global access claims regardless', async () => {
    mockGlobal.mockResolvedValue(true);
    svc.getEscalation.mockResolvedValue(esc('someone-else') as any);
    svc.claimEscalation.mockResolvedValue({ escalation: {}, isExtension: false } as any);
    expect((await claimEscalation({ id: 'esc-1' }, AUTH)).status).toBe(200);
  });
});

describe('resolve — write gate (ack)', () => {
  it('write_self resolves own', async () => {
    scope('self', 'self');
    svc.resolveEscalation.mockResolvedValue({} as any);
    expect((await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH)).status).toBe(200);
    expect(svc.resolveEscalation).toHaveBeenCalled();
  });

  it('write_self cannot resolve another user’s item', async () => {
    scope('all', 'self');
    svc.getEscalation.mockResolvedValue(esc('someone-else') as any);
    expect((await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH)).status).toBe(403);
    expect(svc.resolveEscalation).not.toHaveBeenCalled();
  });

  it('read-only cannot resolve', async () => {
    scope('all', 'none');
    expect((await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH)).status).toBe(403);
    expect(svc.resolveEscalation).not.toHaveBeenCalled();
  });
});

describe('cancel — write gate (delete)', () => {
  it('write_self cancels own, not others', async () => {
    scope('self', 'self');
    svc.cancelEscalation.mockResolvedValue(true as any);
    expect((await cancelSingleEscalation({ id: 'esc-1' }, AUTH)).status).toBe(200);

    vi.clearAllMocks(); mockGlobal.mockResolvedValue(false); scope('self', 'self');
    svc.getEscalation.mockResolvedValue(esc('someone-else') as any);
    expect((await cancelSingleEscalation({ id: 'esc-1' }, AUTH)).status).toBe(403);
    expect(svc.cancelEscalation).not.toHaveBeenCalled();
  });
});

describe('release / escalate — queue-manage gate (write_all only)', () => {
  it('write_self cannot release; write_all can', async () => {
    scope('all', 'self');
    expect((await releaseEscalation({ id: 'esc-1' }, AUTH)).status).toBe(403);
    expect(svc.releaseEscalation).not.toHaveBeenCalled();

    vi.clearAllMocks(); mockGlobal.mockResolvedValue(false); scope('all', 'all');
    svc.getEscalation.mockResolvedValue(esc('me') as any);
    svc.releaseEscalation.mockResolvedValue({} as any);
    expect((await releaseEscalation({ id: 'esc-1' }, AUTH)).status).toBe(200);
  });

  it('write_self cannot escalate; write_all + chain can', async () => {
    scope('all', 'self');
    expect((await escalateToRole({ id: 'esc-1', targetRole: 'senior' }, AUTH)).status).toBe(403);
    expect(svc.escalateToRole).not.toHaveBeenCalled();

    vi.clearAllMocks(); mockGlobal.mockResolvedValue(false); scope('all', 'all');
    svc.getEscalation.mockResolvedValue(esc('me') as any);
    vi.mocked(roleService.canEscalateTo).mockResolvedValue(true);
    svc.escalateToRole.mockResolvedValue({} as any);
    expect((await escalateToRole({ id: 'esc-1', targetRole: 'senior' }, AUTH)).status).toBe(200);
  });
});

describe('create — queue-manage gate (write_all only)', () => {
  it('write_self cannot create; write_all can', async () => {
    scope('all', 'self');
    expect((await createEscalation({ type: 't', role: 'reviewer' }, AUTH)).status).toBe(403);
    expect(svc.createEscalation).not.toHaveBeenCalled();

    vi.clearAllMocks(); mockGlobal.mockResolvedValue(false); scope('all', 'all');
    svc.createEscalation.mockResolvedValue({ id: 'new' } as any);
    expect((await createEscalation({ type: 't', role: 'reviewer' }, AUTH)).status).toBe(201);
  });
});

describe('view single — read gate', () => {
  // The single-escalation GET reads through getEscalationWithFormSchema (the row
  // plus the JOINed, resolved form). The read gate still runs on the record.
  const detail = (assigned_to: string | null) => ({ escalation: esc(assigned_to), form_schema: null });

  it('read_self sees own, not others; read_all sees any', async () => {
    scope('self', 'self');
    svc.getEscalationWithFormSchema.mockResolvedValue(detail('me') as any);
    expect((await getEscalation({ id: 'esc-1' }, AUTH)).status).toBe(200);

    scope('self', 'self');
    svc.getEscalationWithFormSchema.mockResolvedValue(detail('someone-else') as any);
    expect((await getEscalation({ id: 'esc-1' }, AUTH)).status).toBe(403);

    scope('all', 'none');
    expect((await getEscalation({ id: 'esc-1' }, AUTH)).status).toBe(200);
  });
});
