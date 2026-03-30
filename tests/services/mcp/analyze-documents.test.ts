import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Remove all LLM API keys to test the filename-based fallback
const originalOpenAI = process.env.OPENAI_API_KEY;
const originalAnthropic = process.env.ANTHROPIC_API_KEY;

describe('analyzeDocuments — filename fallback', () => {
  beforeEach(() => {
    // Force fallback by removing all LLM API keys
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    // Restore
    if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
    else delete process.env.OPENAI_API_KEY;
    if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('should return high confidence for all _rotated documents', async () => {
    const { analyzeDocuments } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await analyzeDocuments([
      'page1_upside_down_rotated.png',
      'page2_rotated.png',
    ]);
    expect(result.confidence).toBe(0.92);
    expect(result.flags).toEqual([]);
    expect(result.summary).toContain('successfully');
  });

  it('should return low confidence for upside-down documents', async () => {
    const { analyzeDocuments } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await analyzeDocuments([
      'page1_upside_down.png',
      'page2.png',
    ]);
    expect(result.confidence).toBeLessThan(0.85);
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.flags.some((f: string) => f.includes('upside_down'))).toBe(true);
  });

  it('should flag unreadable documents without upside_down marker', async () => {
    const { analyzeDocuments } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await analyzeDocuments([
      'incident_report.pdf',
      'photo_evidence.jpg',
    ]);
    expect(result.confidence).toBeLessThan(0.85);
    expect(result.flags.some((f: string) => f.includes('unreadable'))).toBe(true);
  });

  it('should handle empty document list', async () => {
    const { analyzeDocuments } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await analyzeDocuments([]);
    expect(result.confidence).toBe(0);
    expect(result.flags).toContain('no_documents');
  });

  it('should handle mixed corrected and uncorrected documents', async () => {
    const { analyzeDocuments } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await analyzeDocuments([
      'page1_upside_down_rotated.png',
      'some_uncorrected.png',
    ]);
    expect(result.confidence).toBeLessThan(0.85);
    expect(result.flags.length).toBeGreaterThan(0);
  });
});

describe('validateClaim', () => {
  it('should approve when confidence is high', async () => {
    const { validateClaim } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await validateClaim('MBR-2024-001', 0.92);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain('verified');
  });

  it('should reject when confidence is low', async () => {
    const { validateClaim } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await validateClaim('MBR-2024-001', 0.35);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Insufficient confidence');
  });

  it('should approve at exactly the threshold', async () => {
    const { validateClaim } = await import(
      '../../../examples/workflows/process-claim/activities'
    );
    const result = await validateClaim('MBR-2024-001', 0.85);
    expect(result.valid).toBe(true);
  });
});
