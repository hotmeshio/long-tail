import { describe, it, expect } from 'vitest';

import { assertValidSteps } from '../../../services/scan-code/validate';
import type { ScanStep } from '../../../types';

const check = (step: ScanStep) => () => assertValidSteps([step]);
const present = (choice: Record<string, unknown>): ScanStep =>
  ({ query: {}, verb: 'present', choices: [{ label: 'Arrived', verb: 'resolve', params: { resolverPayload: { outcome: 'arrived' } }, ...choice }] } as ScanStep);
const fill: ScanStep = { query: {}, verb: 'fill', subject: { schemes: [11] }, params: { fill: { into: 'subject' } } };

describe('choice done copy', () => {
  it('a writing choice may carry done copy; it needs markdown', () => {
    expect(check(present({ done: { markdown: 'Moved. Back to the list.' } }))).not.toThrow();
    expect(check(present({ done: { markdown: '' } }))).toThrow(/done.markdown is required/);
    expect(check(present({ done: 'Moved.' }))).toThrow(/done.markdown is required/);
  });

  it('a show choice cannot carry done copy', () => {
    expect(check(present({ verb: 'show-detail', params: undefined, done: { markdown: 'x' } }))).toThrow(/only to choices that write/);
  });
});

describe('choice visibility', () => {
  it('hidden needs roles to hide from', () => {
    expect(check(present({ hidden: true, roles: ['manager'] }))).not.toThrow();
    expect(check(present({ hidden: true }))).toThrow(/hidden requires roles/);
    expect(check(present({ hidden: 'yes' }))).toThrow(/hidden must be a boolean/);
  });

  it('when is a non-empty bag of scalar facet values', () => {
    expect(check(present({ when: { lane: 'north', ready: true } }))).not.toThrow();
    expect(check(present({ when: {} }))).toThrow(/non-empty object/);
    expect(check(present({ when: { 'bad key': 1 } }))).toThrow(/not a facet key/);
    expect(check(present({ when: { lane: ['north'] } }))).toThrow(/string, number, or boolean/);
  });
});

describe('follow', () => {
  it('a completing fill may follow its subject into named roles', () => {
    expect(check({ ...fill, follow: { roles: ['binning-associate'], waitSeconds: 15 } })).not.toThrow();
    expect(check({ ...fill, follow: { roles: ['binning-associate'] } })).not.toThrow();
  });

  it('roles are required and the wait is bounded', () => {
    expect(check({ ...fill, follow: { roles: [] } })).toThrow(/follow.roles/);
    expect(check({ ...fill, follow: { roles: ['x'], waitSeconds: 0 } })).toThrow(/waitSeconds/);
    expect(check({ ...fill, follow: { roles: ['x'], waitSeconds: 121 } })).toThrow(/waitSeconds/);
    expect(check({ ...fill, follow: 'binning' as any })).toThrow(/must be an object/);
  });

  it('follow applies only to a write on the held subject', () => {
    expect(check({ query: {}, verb: 'show-detail', follow: { roles: ['x'] } })).toThrow(/only to steps that write/);
    expect(check({ query: {}, verb: 'resolve', params: { resolverPayload: {} }, follow: { roles: ['x'] } })).toThrow(/held subject/);
  });
});
