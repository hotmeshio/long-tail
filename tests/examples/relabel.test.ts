import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  issueLabels: vi.fn(async () => ({ status: 200, data: { job: { id: 'job-9' }, replay: false, receipt: { accepted: true, detail: 'labels/job-9.zpl' } } })),
  ensureSystemBot: vi.fn(async () => 'bot-1'),
  write: vi.fn(async (key: string, data: Buffer) => ({ ref: key, size: data.length })),
}));

vi.mock('../../api/labels', () => ({ issueLabels: mocks.issueLabels }));
vi.mock('../../services/iam', () => ({ ensureSystemBot: mocks.ensureSystemBot }));
vi.mock('../../lib/storage', () => ({ getStorageBackend: () => ({ write: mocks.write }) }));

import { printLabel } from '../../examples/workflows/relabel/activities';
import { storageDropTransport } from '../../examples/label-transports/storage-drop';

beforeEach(() => vi.clearAllMocks());

describe('printLabel', () => {
  it('prints the named template for the target with its second line, keyed by the workflow', async () => {
    const printed = await printLabel({ template: 'item-label', target: 'A-3', subtitle: 'Acme, North', workflowId: 'wf-1' });
    expect(mocks.issueLabels).toHaveBeenCalledWith({
      template: 'item-label',
      source: { kind: 'list', text: 'target,subtitle\nA-3,Acme  North' },
      layout: { media: 'thermal-4x2' },
      output: 'transport:storage-drop',
      idempotencyKey: 'relabel:wf-1',
    }, { userId: 'bot-1', role: 'superadmin' });
    expect(printed).toEqual({ jobId: 'job-9', replay: false, file: 'labels/job-9.zpl' });
  });

  it('throws when the label is refused, so the activity retries', async () => {
    mocks.issueLabels.mockResolvedValueOnce({ status: 404, error: 'no template' } as any);
    await expect(printLabel({ template: 't', target: 'X', subtitle: 'Y', workflowId: 'wf-2' })).rejects.toThrow(/404/);
  });
});

describe('storageDropTransport', () => {
  it('writes each job to labels/<jobId>.<format>', async () => {
    const receipt = await storageDropTransport.send({ jobId: 'j1', format: 'zpl', payload: '^XA^XZ', labelCount: 1 });
    expect(mocks.write).toHaveBeenCalledWith('labels/j1.zpl', Buffer.from('^XA^XZ'));
    expect(receipt).toEqual({ accepted: true, detail: 'labels/j1.zpl' });
  });

  it('accepts PDF bytes', async () => {
    await storageDropTransport.send({ jobId: 'j2', format: 'pdf', payload: new Uint8Array([1, 2]), labelCount: 1 });
    expect(mocks.write).toHaveBeenCalledWith('labels/j2.pdf', Buffer.from([1, 2]));
  });
});
