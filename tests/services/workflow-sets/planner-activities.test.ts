import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── analyzeSpecification (no external deps) ─────────────────────────────────

import { analyzeSpecification } from '../../../system/workflows/mcp-workflow-planner/activities/analyze';

describe('analyzeSpecification', () => {
  it('detects plan signals in a multi-workflow spec', async () => {
    const spec = `
      This system has three workflows. Step 1 validates the referral.
      Step 2 checks insurance coverage. Step 3 routes to scheduling.
      The composition orchestrates all three sub-processes.
      Then the pipeline delivers results. This is a comprehensive specification
      that describes a multi-step referral intake system with branching paths,
      conditional routing, and human-in-the-loop escalation gates. The system
      processes incoming referrals, validates insurance coverage, verifies
      clinical documents, and routes to the appropriate scheduling queue.
      Each workflow in the plan handles one piece of the intake process.
    `;
    const result = await analyzeSpecification(spec);

    expect(result.requires_plan).toBe(true);
    expect(result.signal_count).toBeGreaterThanOrEqual(2);
    expect(result.char_count).toBeGreaterThan(0);
    expect(result.signals_found.length).toBeGreaterThanOrEqual(2);
  });

  it('returns false for a short simple prompt', async () => {
    const result = await analyzeSpecification('Screenshot google.com and save');
    expect(result.requires_plan).toBe(false);
    expect(result.char_count).toBeLessThan(500);
  });

  it('returns false for a long prompt without structural signals', async () => {
    const filler = 'This is a detailed description of how to capture a screenshot. '.repeat(20);
    const result = await analyzeSpecification(filler);
    expect(result.requires_plan).toBe(false);
    expect(result.signal_count).toBeLessThan(2);
  });

  it('detects plan/composition keywords', async () => {
    const spec = 'x'.repeat(600) + ' The plan involves composing multiple workflows that orchestrate sub-processes step 1 step 2';
    const result = await analyzeSpecification(spec);
    expect(result.requires_plan).toBe(true);
    expect(result.signals_found).toEqual(
      expect.arrayContaining([expect.stringMatching(/plan|compos|orchestrat|workflow|step/i)]),
    );
  });
});

// ── generatePlan (mocked LLM) ───────────────────────────────────────────────

vi.mock('../../../services/llm', () => ({
  callLLM: vi.fn(),
  hasLLMApiKey: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../modules/defaults', () => ({
  LLM_MODEL_PRIMARY: 'test-model',
}));

import { generatePlan } from '../../../system/workflows/mcp-workflow-planner/activities/plan';
import { callLLM } from '../../../services/llm';

describe('generatePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses LLM response into sorted plan items', async () => {
    const llmResponse = {
      plan_name: 'referral-intake',
      plan_description: 'Referral intake pipeline',
      workflows: [
        { name: 'route-referral', description: 'Routes', namespace: 'intake', role: 'composition', dependencies: ['check-coverage'], build_order: 1, io_contract: { input_schema: {}, output_schema: {} } },
        { name: 'check-coverage', description: 'Checks insurance', namespace: 'intake', role: 'leaf', dependencies: [], build_order: 0, io_contract: { input_schema: {}, output_schema: {} } },
      ],
    };
    vi.mocked(callLLM).mockResolvedValue({ content: JSON.stringify(llmResponse) } as any);

    const result = await generatePlan('Build a referral intake system');

    expect(result.plan_name).toBe('referral-intake');
    expect(result.workflows).toHaveLength(2);
    // Sorted by build_order: leaf first
    expect(result.workflows[0].name).toBe('check-coverage');
    expect(result.workflows[0].build_order).toBe(0);
    expect(result.workflows[1].name).toBe('route-referral');
    expect(result.workflows[1].build_order).toBe(1);
  });

  it('throws on empty workflow list', async () => {
    vi.mocked(callLLM).mockResolvedValue({ content: JSON.stringify({ workflows: [] }) } as any);

    await expect(generatePlan('test')).rejects.toThrow('empty workflow list');
  });

  it('strips markdown fences from LLM response', async () => {
    const json = JSON.stringify({
      plan_name: 'test',
      plan_description: 'test',
      workflows: [{ name: 'wf-1', description: 'd', namespace: 'ns', role: 'leaf', dependencies: [], build_order: 0, io_contract: { input_schema: {}, output_schema: {} } }],
    });
    vi.mocked(callLLM).mockResolvedValue({ content: `\`\`\`json\n${json}\n\`\`\`` } as any);

    const result = await generatePlan('test');
    expect(result.workflows).toHaveLength(1);
  });

  it('defaults missing fields', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      content: JSON.stringify({
        workflows: [{ name: 'wf-1', description: 'd', namespace: 'ns' }],
      }),
    } as any);

    const result = await generatePlan('test');
    expect(result.plan_name).toBe('unnamed-plan');
    expect(result.workflows[0].role).toBe('leaf');
    expect(result.workflows[0].dependencies).toEqual([]);
    expect(result.workflows[0].build_order).toBe(0);
    expect(result.workflows[0].io_contract).toEqual({ input_schema: {}, output_schema: {} });
  });
});
