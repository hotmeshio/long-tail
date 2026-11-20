import { describe, it, expect } from 'vitest';
import { findQuote, type TextRun } from '../document/find-quote';

const run = (str: string): TextRun => ({ str, transform: [1, 0, 0, 1, 0, 0], width: str.length * 5, height: 10 });

describe('findQuote', () => {
  it('finds a quote inside one run and returns the covered share of it', () => {
    const matches = findQuote([run('Callus formation at 1st metatarsal.')], 'formation at 1st')!;
    expect(matches).toHaveLength(1);
    expect(matches[0].runIndex).toBe(0);
    expect(matches[0].from).toBeCloseTo(7 / 35);
    expect(matches[0].to).toBeCloseTo(23 / 35);
  });

  it('spans runs, ignoring case and whitespace', () => {
    const matches = findQuote([run('Hammer toes'), run('  bilaterally,'), run('no ulcer.')], 'HAMMER toes bilaterally')!;
    expect(matches.map((m) => m.runIndex)).toEqual([0, 1]);
    expect(matches[0].from).toBe(0);
    expect(matches[0].to).toBe(1);
  });

  it('falls back to the opening words when the end of the quote differs', () => {
    const page = [run('Callus formation at the first and fifth metatarsal heads bilaterally on exam today.')];
    const quote = 'Callus formation at the first and fifth metatarsal heads bilaterally, with pain on palpation noted by the examiner';
    expect(findQuote(page, quote)).not.toBeNull();
  });

  it('returns null when the quote is absent or the page has no text', () => {
    expect(findQuote([run('Nothing relevant')], 'callus')).toBeNull();
    expect(findQuote([], 'callus')).toBeNull();
    expect(findQuote([run('text')], '   ')).toBeNull();
  });
});
