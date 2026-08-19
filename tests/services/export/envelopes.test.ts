import { describe, it, expect, vi, beforeEach } from 'vitest';

// getWorkflowEnvelopes — the effortless read: two narrow lookups
// (handle.input + handle.output), never blocking, output null while running.

const mockGetHandle = vi.fn();
vi.mock('../../../services/export/client', () => ({
  getHandle: (...a: unknown[]) => mockGetHandle(...a),
}));

import { getWorkflowEnvelopes } from '../../../services/export';

function handleWith(overrides: Record<string, unknown>) {
  return {
    status: vi.fn(),
    input: vi.fn(),
    output: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getWorkflowEnvelopes', () => {
  it('a running workflow answers its input with output null — output() is never called', async () => {
    const handle = handleWith({
      status: vi.fn().mockResolvedValue(2),
      input: vi.fn().mockResolvedValue([{ data: { orderId: 'ord-1' } }]),
    });
    mockGetHandle.mockResolvedValue(handle);

    const result = await getWorkflowEnvelopes('wf-1', 'q', 'reviewContent');
    expect(result).toEqual({
      workflow_id: 'wf-1',
      status: 'running',
      input: { data: { orderId: 'ord-1' } },
      output: null,
    });
    expect(handle.output).not.toHaveBeenCalled();
  });

  it('a completed workflow answers both envelopes — the single arg unwrapped', async () => {
    const handle = handleWith({
      status: vi.fn().mockResolvedValue(0),
      input: vi.fn().mockResolvedValue([{ data: { orderId: 'ord-1' } }]),
      output: vi.fn().mockResolvedValue({ type: 'return', data: { approved: true } }),
    });
    mockGetHandle.mockResolvedValue(handle);

    const result = await getWorkflowEnvelopes('wf-1', 'q', 'reviewContent');
    expect(result).toEqual({
      workflow_id: 'wf-1',
      status: 'completed',
      input: { data: { orderId: 'ord-1' } },
      output: { type: 'return', data: { approved: true } },
    });
  });

  it('multi-arg workflows keep the args array verbatim', async () => {
    const handle = handleWith({
      status: vi.fn().mockResolvedValue(0),
      input: vi.fn().mockResolvedValue(['a', 'b']),
      output: vi.fn().mockResolvedValue('done'),
    });
    mockGetHandle.mockResolvedValue(handle);

    const result = await getWorkflowEnvelopes('wf-2', 'q', 'multiArg');
    expect(result.input).toEqual(['a', 'b']);
  });

  it('a failed workflow surfaces its own error as the outcome', async () => {
    const handle = handleWith({
      status: vi.fn().mockResolvedValue(-1),
      input: vi.fn().mockResolvedValue([{ data: {} }]),
      output: vi.fn().mockRejectedValue(new Error('boom at step 3')),
    });
    mockGetHandle.mockResolvedValue(handle);

    const result = await getWorkflowEnvelopes('wf-3', 'q', 'flaky');
    expect(result.status).toBe('failed');
    expect(result.output).toBeNull();
    expect(result.error).toBe('boom at step 3');
  });

  it('an unreadable input degrades to null rather than failing the read', async () => {
    const handle = handleWith({
      status: vi.fn().mockResolvedValue(0),
      input: vi.fn().mockRejectedValue(new Error('no such field')),
      output: vi.fn().mockResolvedValue({ ok: true }),
    });
    mockGetHandle.mockResolvedValue(handle);

    const result = await getWorkflowEnvelopes('wf-4', 'q', 'legacy');
    expect(result.input).toBeNull();
    expect(result.output).toEqual({ ok: true });
  });

  it('an unknown workflow answers 404 semantics', async () => {
    mockGetHandle.mockRejectedValue(new Error('nope'));
    await expect(getWorkflowEnvelopes('ghost', 'q', 'x')).rejects.toMatchObject({ status: 404 });
  });
});
