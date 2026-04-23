import { describe, it, expect } from 'vitest';
import { loadReferenceSection } from '../../../system/workflows/mcp-workflow-builder/activities/tool-loader';

describe('loadReferenceSection', () => {
  it('loads the await section from activity-types.md', async () => {
    const content = await loadReferenceSection('await');

    expect(content).toContain('## await');
    expect(content).toContain('type: await');
    expect(content).toContain('await: true');
    expect(content).toContain('fire-and-forget');
  });

  it('loads the signal section', async () => {
    const content = await loadReferenceSection('signal');

    expect(content).toContain('## signal');
    expect(content).toContain('subtype: one');
    expect(content).toContain('subtype: all');
  });

  it('loads the interrupt section', async () => {
    const content = await loadReferenceSection('interrupt');

    expect(content).toContain('## interrupt');
    expect(content).toContain('type: interrupt');
    expect(content).toContain('descend');
  });

  it('returns only the requested section, not others', async () => {
    const content = await loadReferenceSection('await');

    // Should not contain sibling sections
    expect(content).not.toContain('## signal');
    expect(content).not.toContain('## interrupt');
  });
});
