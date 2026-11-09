import { describe, it, expect, vi, beforeEach } from 'vitest';

// get_escalation_files over /mcp answers as the caller, through the same
// read check as GET /api/escalations/:id/files.

const getEscalationFiles = vi.fn();
vi.mock('../../../api/escalations/files', () => ({ getEscalationFiles: (...a: unknown[]) => getEscalationFiles(...a) }));

import { createHumanQueueServer } from '../../../system/mcp-servers/human-queue';

async function call(userId?: string) {
  const server = await createHumanQueueServer({ name: 'hq-files-test' });
  const tool = (server as any)._registeredTools.get_escalation_files;
  const extra = userId ? { authInfo: { userId, role: 'member' } } : undefined;
  const result = await tool.handler({ escalation_id: 'esc-1' }, extra);
  return { isError: !!result.isError, body: JSON.parse(result.content[0].text) };
}

beforeEach(() => getEscalationFiles.mockReset());

describe('get_escalation_files as the /mcp caller', () => {
  it('signs as the caller and answers the links', async () => {
    getEscalationFiles.mockResolvedValue({ status: 200, data: { files: [{ as: 'referral', url: 'https://s3.test/r' }] } });
    const { isError, body } = await call('member-1');
    expect(isError).toBe(false);
    expect(body).toEqual({ escalation_id: 'esc-1', files: [{ as: 'referral', url: 'https://s3.test/r' }] });
    expect(getEscalationFiles).toHaveBeenCalledWith({ id: 'esc-1' }, expect.objectContaining({ userId: 'member-1' }));
  });

  it('reports the read check\'s refusal as an error', async () => {
    getEscalationFiles.mockResolvedValue({ status: 403, error: 'Not authorized to view this escalation' });
    const { isError, body } = await call('outsider');
    expect(isError).toBe(true);
    expect(body).toEqual({ error: 'Not authorized to view this escalation' });
  });
});
