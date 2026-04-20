import { describe, it, expect } from 'vitest';

import { BUILDER_SYSTEM_PROMPT, REFINE_PROMPT } from '../../../system/workflows/mcp-workflow-builder/prompts';

describe('BUILDER_SYSTEM_PROMPT', () => {
  const inventory = '• long-tail-playwright-cli [browser] (5 tools): capture_page, extract_content';
  const prompt = BUILDER_SYSTEM_PROMPT(inventory);

  it('includes HotMesh activity type documentation', () => {
    expect(prompt).toContain('### trigger');
    expect(prompt).toContain('### worker');
    expect(prompt).toContain('### hook');
    expect(prompt).toContain('### cycle');
  });

  it('includes @pipe mapping syntax', () => {
    expect(prompt).toContain("'@pipe'");
    expect(prompt).toContain('@string.concat');
    expect(prompt).toContain('@date.toISOString');
    expect(prompt).toContain('@string.substring');
  });

  it('includes all @pipe operator categories', () => {
    expect(prompt).toContain('**@string**');
    expect(prompt).toContain('**@date**');
    expect(prompt).toContain('**@math**');
    expect(prompt).toContain('**@array**');
    expect(prompt).toContain('**@object**');
    expect(prompt).toContain('**@conditional**');
    expect(prompt).toContain('**@json**');
  });

  it('includes data flow mapping directions', () => {
    expect(prompt).toContain('input.maps');
    expect(prompt).toContain('output.maps');
    expect(prompt).toContain('job.maps');
  });

  it('includes construction rules for workflowName and _scope', () => {
    expect(prompt).toContain('workflowName');
    expect(prompt).toContain('_scope');
  });

  it('includes file extension rule for screenshots', () => {
    expect(prompt).toContain('.png');
  });

  it('includes the tool inventory', () => {
    expect(prompt).toContain('long-tail-playwright-cli');
    expect(prompt).toContain('capture_page');
  });

  it('specifies output format with required fields', () => {
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"yaml"');
    expect(prompt).toContain('"input_schema"');
    expect(prompt).toContain('"activity_manifest"');
    expect(prompt).toContain('"sample_inputs"');
  });

  it('documents nested @pipe for date concatenation', () => {
    expect(prompt).toContain('@date.toISOString');
    expect(prompt).toContain('@string.substring');
  });

  it('includes activity manifest format', () => {
    expect(prompt).toContain('activity_id');
    expect(prompt).toContain('tool_source');
    expect(prompt).toContain('mcp_server_id');
    expect(prompt).toContain('mcp_tool_name');
  });
});

describe('REFINE_PROMPT', () => {
  it('mentions common issues to check', () => {
    expect(REFINE_PROMPT).toContain('.png');
    expect(REFINE_PROMPT).toContain('_scope');
    expect(REFINE_PROMPT).toContain('workflowName');
    expect(REFINE_PROMPT).toContain('job.maps');
  });

  it('mentions field name matching', () => {
    expect(REFINE_PROMPT).toContain('Field name mismatch');
  });

  it('instructs to return same JSON format', () => {
    expect(REFINE_PROMPT).toContain('same JSON format');
  });
});
