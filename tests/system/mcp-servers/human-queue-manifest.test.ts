import { describe, it, expect } from 'vitest';

import { createHumanQueueServer } from '../../../system/mcp-servers/human-queue';
import { HUMAN_QUEUE_TOOLS } from '../../../system/seed/tool-manifests-escalation';

// /mcp lists a tool only when the served server registers it and its manifest
// entry gates it, so the two lists must match exactly.

describe('human-queue manifest', () => {
  it('names exactly the tools the served server registers', async () => {
    const server = await createHumanQueueServer({ name: 'hq-manifest-test' });
    const registered = Object.keys((server as any)._registeredTools).sort();
    expect(registered).toEqual(HUMAN_QUEUE_TOOLS.map((t) => t.name).sort());
  });

  it('opens get_escalation_lookups to any caller; every other tool stays superadmin', () => {
    for (const entry of HUMAN_QUEUE_TOOLS) {
      expect(entry.gate, entry.name).toBe(entry.name === 'get_escalation_lookups' ? 'caller' : 'superadmin');
    }
  });
});
