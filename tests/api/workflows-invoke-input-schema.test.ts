import { describe, it, expect, vi, beforeEach } from 'vitest';

// The invoke input gate at the API boundary: real shared validation pass,
// stubbed services. A declared input_schema rejects bad data with the
// canonical 422 body before the workflow starts; no schema, no gate.
const mockInvoke = vi.fn();
const mockCheckRoles = vi.fn();
const mockGetConfig = vi.fn();

vi.mock('../../services/workflow-invocation', () => ({
  invokeWorkflow: (...a: unknown[]) => mockInvoke(...a),
  checkInvocationRoles: (...a: unknown[]) => mockCheckRoles(...a),
  InvocationError: class InvocationError extends Error { statusCode = 403; },
}));
vi.mock('../../services/config', () => ({
  getWorkflowConfig: (...a: unknown[]) => mockGetConfig(...a),
}));
vi.mock('../../services/export', () => ({}));
vi.mock('../../services/task', () => ({ resolveWorkflowHandle: vi.fn() }));
vi.mock('../../services/escalation/crud', () => ({ cancelEscalationsByWorkflowId: vi.fn() }));
vi.mock('../../workers', () => ({ createClient: vi.fn() }));

import { invokeWorkflow } from '../../api/workflows/invocation';
import { LT_ERROR_CODES } from '../../types/validation';

const AUTH = { userId: 'u1', role: 'member' };
const SCHEMA = {
  required: ['serialNumber', 'action', 'copies'],
  properties: {
    serialNumber: { type: 'string', 'x-lt-bind': 'printer.serialNumber' },
    action: { type: 'string', enum: ['reprint-label', 'retire'] },
    copies: { type: 'number', minimum: 1, 'x-lt-showIf': 'input.action=reprint-label' },
  },
};
const config = (input_schema: unknown) => ({ workflow_type: 'fleetTools', invocable: true, invocation_roles: [], input_schema });

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRoles.mockResolvedValue(undefined);
  mockInvoke.mockResolvedValue({ workflowId: 'wf-1' });
});

describe('POST invoke with input_schema', () => {
  it('rejects a payload missing required fields with the canonical 422 body, nothing started', async () => {
    mockGetConfig.mockResolvedValue(config(SCHEMA));
    const result = await invokeWorkflow({ type: 'fleetTools', data: {} }, AUTH);
    expect(result.status).toBe(422);
    expect(result.code).toBe(LT_ERROR_CODES.SCHEMA_VALIDATION);
    expect(result.data).toMatchObject({
      code: LT_ERROR_CODES.SCHEMA_VALIDATION,
      role: null,
      schemaVersion: null,
      workflowType: 'fleetTools',
    });
    expect(result.data.violations.map((v: any) => v.field)).toEqual(['serialNumber', 'action']);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('skips fields a showIf hides, and reads bound paths from the nested data', async () => {
    mockGetConfig.mockResolvedValue(config(SCHEMA));
    const result = await invokeWorkflow(
      { type: 'fleetTools', data: { printer: { serialNumber: 'sn-1' }, action: 'retire' } },
      AUTH,
    );
    expect(result.status).toBe(202);
    expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({ workflowType: 'fleetTools' }));
  });

  it('enforces the visible conditional field', async () => {
    mockGetConfig.mockResolvedValue(config(SCHEMA));
    const result = await invokeWorkflow(
      { type: 'fleetTools', data: { printer: { serialNumber: 'sn-1' }, action: 'reprint-label', copies: 0 } },
      AUTH,
    );
    expect(result.status).toBe(422);
    expect(result.data.violations[0].field).toBe('copies');
  });

  it('no input_schema means no gate', async () => {
    mockGetConfig.mockResolvedValue(config(null));
    const result = await invokeWorkflow({ type: 'basicEcho', data: {} }, AUTH);
    expect(result.status).toBe(202);
  });

  it('a data value that is not an object is left to the service, never a 422', async () => {
    mockGetConfig.mockResolvedValue(config(SCHEMA));
    mockInvoke.mockRejectedValue(Object.assign(new Error('Request body must include a data object'), { statusCode: 400 }));
    const result = await invokeWorkflow({ type: 'fleetTools', data: 'nope' as unknown as Record<string, any> }, AUTH);
    expect(result.status).not.toBe(422);
    expect(mockInvoke).toHaveBeenCalled();
  });

  it('an unregistered workflow passes through to the service', async () => {
    mockGetConfig.mockResolvedValue(null);
    const result = await invokeWorkflow({ type: 'adhoc', data: { anything: 1 } }, AUTH);
    expect(result.status).toBe(202);
  });
});
