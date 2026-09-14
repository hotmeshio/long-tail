import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const navigate = vi.fn();
const mutateAsync = vi.fn();
let realIsBuilder = false;

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../../../api/workflows', () => ({
  useInvokeWorkflow: () => ({ mutateAsync, isPending: false, reset: vi.fn() }),
}));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ realIsBuilder }) }));

import { ApiError } from '../../../../api/client';
import { useInvokeSubmit, EXECUTIONS_PATH } from '../use-invoke-submit';

const selected = { workflow_type: 'fleetTools' };

beforeEach(() => {
  vi.clearAllMocks();
  realIsBuilder = false;
  mutateAsync.mockResolvedValue({ workflowId: 'wf-1', message: 'Workflow started' });
});

describe('useInvokeSubmit', () => {
  it('posts data and metadata, stamping certified and the identity override', async () => {
    const { result } = renderHook(() => useInvokeSubmit(selected, { certified: true, overrideBot: 'bot-1' }));
    await act(() => result.current.submit({ a: 1 }, { source: 'dashboard' }));
    expect(mutateAsync).toHaveBeenCalledWith({
      workflowType: 'fleetTools',
      data: { a: 1 },
      metadata: { source: 'dashboard', certified: true },
      execute_as: 'bot-1',
    });
  });

  it('a non-builder stays put and sees the started id with no execution link', async () => {
    const { result } = renderHook(() => useInvokeSubmit(selected, { certified: false, overrideBot: '' }));
    await act(() => result.current.submit({}, {}));
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.startedId).toBe('wf-1');
    expect(result.current.executionPath).toBeNull();
  });

  it('a builder stays too and gets the link to the execution', async () => {
    realIsBuilder = true;
    const { result } = renderHook(() => useInvokeSubmit(selected, { certified: false, overrideBot: '' }));
    await act(() => result.current.submit({}, {}));
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.startedId).toBe('wf-1');
    expect(result.current.executionPath).toBe(`${EXECUTIONS_PATH}/wf-1`);
  });

  it('a 422 becomes field violations; any other failure is the error line', async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError('422', 422, {
      code: 'schema_validation', error: 'data failed input schema validation (1 violation)',
      violations: [{ field: 'serialNumber', message: 'Required' }],
    }));
    const { result } = renderHook(() => useInvokeSubmit(selected, { certified: false, overrideBot: '' }));
    await act(() => result.current.submit({}, {}));
    expect(result.current.violations).toEqual([{ field: 'serialNumber', message: 'Required' }]);
    expect(result.current.error).toMatch(/1 violation/);

    mutateAsync.mockRejectedValueOnce(new Error('boom'));
    await act(() => result.current.submit({}, {}));
    expect(result.current.violations).toEqual([]);
    expect(result.current.error).toBe('boom');
  });
});
