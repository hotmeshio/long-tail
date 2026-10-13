import { describe, it, expect } from 'vitest';

import { assertValidSteps } from '../../../services/scan-code';
import type { ScanStep } from '../../../types';

const present = (facts: unknown): ScanStep => ({
  query: { roles: ['bin'] }, verb: 'present',
  choices: [{ label: 'View', verb: 'show-detail' }],
  facts: facts as ScanStep['facts'],
});
const check = (step: ScanStep) => () => assertValidSteps([step]);

describe('present facts', () => {
  it('accepts labeled templates that read the presented row and the scan', () => {
    expect(check(present([{ label: 'Bin', value: '{item.binCode}' }, { label: 'Code', value: '{scan.target}' }]))).not.toThrow();
  });

  it('applies only to present steps', () => {
    expect(check({ query: {}, verb: 'show-detail', facts: [{ label: 'x', value: 'y' }] })).toThrow(/only to present/);
  });

  it('must be 1-12 entries, each with a label and a template value', () => {
    expect(check(present([]))).toThrow(/1-12/);
    expect(check(present(Array.from({ length: 13 }, () => ({ label: 'a', value: 'b' }))))).toThrow(/1-12/);
    expect(check(present([{ label: ' ', value: 'x' }]))).toThrow(/label/);
    expect(check(present([{ label: 'Bin', value: 3 }]))).toThrow(/value/);
  });

  it('{item.x} in facts names a facet key; outside facts a present step cannot read it', () => {
    expect(check(present([{ label: 'Bin', value: '{item.bin code}' }]))).toThrow(/facet key/);
    expect(check({ query: {}, verb: 'show-detail', params: { metadata: { bin: '{item.binCode}' } } }))
      .toThrow(/reads the located item row/);
  });

  it('{subject.x} and {container.x} stay out of facts', () => {
    expect(check(present([{ label: 'Held', value: '{subject.binCode}' }]))).toThrow(/subject gate/);
    expect(check(present([{ label: 'Box', value: '{container.binCode}' }]))).toThrow(/refusal or done copy/);
  });
});
