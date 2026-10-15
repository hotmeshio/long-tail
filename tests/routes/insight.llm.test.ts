import { describe, it, expect } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

// Each request starts a real LLM workflow run.

const ctx = setupRouteTest(4651);

async function post(path: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`${ctx.BASE}/insight/${path}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

describe('Insight routes with an LLM key', () => {
  it('POST /mcp-query starts a query workflow', async () => {
    const res = await post('mcp-query', ctx.adminToken, { prompt: 'test query', wait: false });
    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBeDefined();
    expect(res.body.status).toBe('started');
  });

  it('POST /mcp-query/describe returns a description and tags', async () => {
    const res = await post('mcp-query/describe', ctx.adminToken, { prompt: 'Count active users by role' });
    expect(res.status).toBe(200);
    expect(typeof res.body.description).toBe('string');
    expect(Array.isArray(res.body.tags)).toBe(true);
  });

  it('POST /build-workflow starts a builder workflow', async () => {
    const res = await post('build-workflow', ctx.builderToken, {
      prompt: 'screenshot a webpage and save it', tags: ['browser-automation'], wait: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBeDefined();
    expect(res.body.status).toBe('started');
  });

  it('POST /build-workflow/refine starts a builder workflow', async () => {
    const res = await post('build-workflow/refine', ctx.builderToken, {
      prompt: 'screenshot a webpage',
      prior_yaml: 'app:\n  id: test\n  version: "1"',
      feedback: 'screenshot_path missing .png extension',
      wait: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.workflow_id).toBeDefined();
  });
});
