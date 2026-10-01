import { describe, it, expect } from 'vitest';

import { HTTP_FETCH_TOOLS, OAUTH_TOOLS } from '../../../system/seed/tool-manifests-data';

// Tools that reach other systems are never read-safe, so a read-only grant or
// key never sees them, and fetching a URL from the server needs builder.
const entry = (tools: Array<{ name: string; gate?: string; read_safe?: boolean }>, name: string) =>
  tools.find((t) => t.name === name)!;

describe('manifest exposure policy', () => {
  it('server-side fetches need builder and are not read-safe', () => {
    for (const name of ['fetch_json', 'fetch_text', 'http_request']) {
      expect(entry(HTTP_FETCH_TOOLS, name)).toMatchObject({ gate: 'builder' });
      expect(entry(HTTP_FETCH_TOOLS, name).read_safe).not.toBe(true);
    }
  });

  it('handing out a stored third-party token is not read-safe', () => {
    expect(entry(OAUTH_TOOLS, 'get_access_token').read_safe).toBe(false);
  });
});
