import { describe, it, expect } from 'vitest';

import { EMPTY_FORM, formToPayload, serverToForm } from '../server-form-types';

describe('network server headers in the form', () => {
  it('an edit keeps the stored headers', () => {
    const stored = {
      name: 'remote-longtail', description: null, transport_type: 'streamable-http',
      transport_config: { url: 'https://lt.example.com/mcp', headers: { Authorization: 'Bearer k' } },
      auto_connect: false, tags: [], credential_providers: [], tool_manifest: null, metadata: null,
    } as any;
    const payload = formToPayload(serverToForm(stored));
    expect(payload.transport_config).toEqual({ url: 'https://lt.example.com/mcp', headers: { Authorization: 'Bearer k' } });
  });

  it('empty headers leave transport_config as the url alone', () => {
    const payload = formToPayload({ ...EMPTY_FORM, name: 'x', url: 'https://a/mcp' });
    expect(payload.transport_config).toEqual({ url: 'https://a/mcp' });
  });
});
