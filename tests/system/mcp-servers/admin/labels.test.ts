import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureSystemBot: vi.fn(async () => '11111111-1111-1111-1111-111111111111'),
  issueLabels: vi.fn(async () => ({
    status: 200,
    data: { job: { id: 'job-1', label_count: 2 }, warnings: [], pdf: new Uint8Array([37, 80, 68, 70]) },
  })),
  getLabelTemplate: vi.fn(async (name: string) => (name === 'badge'
    ? { name, scheme_version: 11, sensitive: true }
    : { name, scheme_version: 14, sensitive: false })),
  getScanScheme: vi.fn(async (v: number) => ({ version: v, kind: v === 11 ? 'identity' : 'action' })),
  write: vi.fn(async (key: string) => ({ ref: key, size: 4 })),
  getSignedUrl: vi.fn(async (key: string, seconds: number) => `https://files.example/${key}?ttl=${seconds}`),
}));

vi.mock('../../../../services/iam', () => ({ ensureSystemBot: mocks.ensureSystemBot }));
vi.mock('../../../../api/labels', async (io) => ({
  ...(await io<typeof import('../../../../api/labels')>()),
  issueLabels: mocks.issueLabels,
}));
vi.mock('../../../../services/labels', async (io) => ({
  ...(await io<typeof import('../../../../services/labels')>()),
  getLabelTemplate: mocks.getLabelTemplate,
}));
vi.mock('../../../../services/scan-code', async (io) => ({
  ...(await io<typeof import('../../../../services/scan-code')>()),
  getScanScheme: mocks.getScanScheme,
}));
vi.mock('../../../../lib/storage', () => ({
  getStorageBackend: () => ({ write: mocks.write, getSignedUrl: mocks.getSignedUrl }),
}));

import { registerLabelTools } from '../../../../system/mcp-servers/admin/labels';

const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'admin' };
const tools = new Map<string, (args: any, extra?: any) => Promise<any>>();
registerLabelTools({ registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any);

const parse = (result: any) => JSON.parse(result.content[0].text);

beforeEach(() => vi.clearAllMocks());

describe('render_label_sheet', () => {
  it('refuses a badge template without issuing anything', async () => {
    const result = await tools.get('render_label_sheet')!({ template: 'badge', source: { kind: 'list', text: 'x' }, format: 'pdf' }, { authInfo: CALLER });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toMatch(/a person prints it/);
    expect(mocks.issueLabels).not.toHaveBeenCalled();
  });

  it('issues as the caller, stores the file, and returns a short-lived link', async () => {
    const result = await tools.get('render_label_sheet')!(
      { template: 'item-label', source: { kind: 'range', from: 1, to: 2 }, format: 'pdf', media: 'a4-l7160' },
      { authInfo: CALLER },
    );
    expect(mocks.issueLabels).toHaveBeenCalledWith(expect.objectContaining({ template: 'item-label', output: 'pdf' }), CALLER);
    expect(mocks.write).toHaveBeenCalledWith('labels/job-1.pdf', expect.any(Buffer));
    expect(parse(result)).toEqual({
      jobId: 'job-1', labelCount: 2, ref: 'labels/job-1.pdf', url: 'https://files.example/labels/job-1.pdf?ttl=600', warnings: [],
    });
  });

  it('passes an issue refusal through as an error', async () => {
    mocks.issueLabels.mockResolvedValueOnce({ status: 403, error: 'printing labels requires admin' } as any);
    const result = await tools.get('render_label_sheet')!({ template: 'item-label', source: { kind: 'list', text: 'x' }, format: 'pdf' }, { authInfo: CALLER });
    expect(result.isError).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe('template tools', () => {
  it('registers list, upsert and delete', () => {
    expect([...tools.keys()].sort()).toEqual(['delete_label_template', 'list_label_templates', 'render_label_sheet', 'upsert_label_template']);
  });
});
