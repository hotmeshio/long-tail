import { describe, it, expect, vi, beforeEach } from 'vitest';

const createAnnouncement = vi.hoisted(() => vi.fn(async () => ({ status: 201, data: { id: 'a1' } })));
vi.mock('../../../../api/announcements', () => ({ createAnnouncement }));

import { registerAnnouncementTools } from '../../../../system/mcp-servers/admin/announcements';

const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'admin' };
const tools = new Map<string, (args: any, extra?: any) => Promise<any>>();
registerAnnouncementTools({ registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any);

beforeEach(() => vi.clearAllMocks());

describe('publish_announcement attribution', () => {
  it('attributes the announcement to the external caller', async () => {
    await tools.get('publish_announcement')!({ body: 'hello' }, { authInfo: CALLER });
    expect(createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ body: 'hello' }), CALLER);
  });

  it('attributes internal calls to lt-system', async () => {
    await tools.get('publish_announcement')!({ body: 'hello' });
    expect(createAnnouncement).toHaveBeenCalledWith(expect.anything(), { userId: 'lt-system', role: 'superadmin' });
  });

  it('returns the created announcement unchanged', async () => {
    const result = await tools.get('publish_announcement')!({ body: 'hello' }, { authInfo: CALLER });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: 'a1' });
  });
});
