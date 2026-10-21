import { describe, it, expect } from 'vitest';

import { assertValidSteps } from '../../../services/scan-code';
import type { ScanStep } from '../../../types';

const check = (step: ScanStep) => () => assertValidSteps([step]);

const hold = (show?: unknown): ScanStep => ({
  query: { roles: ['matching'] }, verb: 'hold',
  params: { hold: { expect: { schemes: [16] }, ...(show !== undefined ? { show } : {}) } },
} as ScanStep);

const fill = (extra: Record<string, unknown>): ScanStep => ({
  query: {}, verb: 'fill', subject: { schemes: [11] },
  params: { fill: { into: 'subject', ...extra } },
} as ScanStep);

const present = (choice: Record<string, unknown>): ScanStep => ({
  query: { roles: ['packing'] }, verb: 'present',
  choices: [{ label: 'Add without scan', verb: 'show-detail', ...choice }],
} as ScanStep);

describe('hold.show', () => {
  it('names a form field', () => {
    expect(check(hold('shoes'))).not.toThrow();
    expect(check(hold())).not.toThrow();
  });

  it('rejects anything that is not a field name', () => {
    expect(check(hold(''))).toThrow(/hold.show/);
    expect(check(hold('envelope.shoes'))).toThrow(/hold.show/);
    expect(check(hold(3))).toThrow(/hold.show/);
  });
});

describe('fill.labels and fill.label', () => {
  it('reads a map on the batch row, with an optional template', () => {
    expect(check(fill({ labels: 'envelope.shoe_labels' }))).not.toThrow();
    expect(check(fill({ labels: 'metadata.names', label: '{label.model} (UPC {code})' }))).not.toThrow();
  });

  it('rejects a map outside the row and a template without a map', () => {
    expect(check(fill({ labels: 'lookup.shoes' }))).toThrow(/fill.labels/);
    expect(check(fill({ labels: '' }))).toThrow(/fill.labels/);
    expect(check(fill({ label: '{label.model}' }))).toThrow(/requires params.fill.labels/);
    expect(check(fill({ labels: 'envelope.x', label: '  ' }))).toThrow(/fill.label/);
  });
});

describe('choice roles', () => {
  it('accepts roles with an optional refusal', () => {
    expect(check(present({ roles: ['manager'] }))).not.toThrow();
    expect(check(present({ roles: ['manager', 'lead'], refuse: "A manager's badge is needed." }))).not.toThrow();
  });

  it('rejects empty or malformed roles and an empty refusal', () => {
    expect(check(present({ roles: [] }))).toThrow(/roles/);
    expect(check(present({ roles: [''] }))).toThrow(/roles/);
    expect(check(present({ roles: 'manager' }))).toThrow(/roles/);
    expect(check(present({ roles: ['manager'], refuse: ' ' }))).toThrow(/refuse/);
  });
});
