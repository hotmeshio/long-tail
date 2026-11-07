import { describe, it, expect } from 'vitest';

import { assertValidSteps } from '../../../services/scan-code';
import type { ScanStep } from '../../../types';

// The station vocabulary: done timing, Open, the hold's release and all-in
// copy, a present step's roster, a fill's preferred keys, and {located.…}.

const hold = (over: Record<string, unknown> = {}, step: Partial<ScanStep> = {}): ScanStep => ({
  query: { roles: ['transfer'] }, verb: 'hold',
  params: { hold: { show: 'roster', ...over } },
  ...step,
} as ScanStep);

const fill = (over: Record<string, unknown> = {}, step: Partial<ScanStep> = {}): ScanStep => ({
  query: {}, verb: 'fill', subject: { schemes: [11] },
  params: { fill: { into: 'subject', ...over } },
  ...step,
} as ScanStep);

const present = (over: Partial<ScanStep> = {}): ScanStep => ({
  query: { roles: ['transfer'] }, verb: 'present',
  choices: [{ label: 'Arrive', verb: 'resolve', params: { resolverPayload: { arrived: true } } }],
  ...over,
} as ScanStep);

const check = (step: ScanStep) => () => assertValidSteps([step]);

describe('done copy', () => {
  it('takes a pause of 0-60 seconds and a next prompt', () => {
    expect(check(fill({}, { done: { markdown: 'In.', afterSeconds: 5, nextPrompt: 'Drop it in **A3**' } }))).not.toThrow();
    expect(check(fill({}, { done: { markdown: 'In.', afterSeconds: 61 } }))).toThrow(/afterSeconds must be an integer from 0 to 60/);
    expect(check(fill({}, { done: { markdown: 'In.', afterSeconds: 1.5 } }))).toThrow(/afterSeconds/);
    expect(check(fill({}, { done: { markdown: 'In.', nextPrompt: ' ' } }))).toThrow(/nextPrompt must be non-empty/);
  });
});

describe('open', () => {
  it('opens the row, the subject or the located row, and may claim', () => {
    expect(check(hold({}, { open: { target: 'subject', claim: true } }))).not.toThrow();
    expect(check(fill({}, { open: { target: 'row', label: 'Open the order' } }))).not.toThrow();
    expect(check(fill({}, { open: { target: 'located' } }))).not.toThrow();
    expect(check(fill({}, { open: { target: 'elsewhere' as any } }))).toThrow(/open.target must be/);
  });

  it("'subject' needs a held subject", () => {
    expect(check(present({ open: { target: 'subject' } }))).toThrow(/needs a held subject/);
  });

  it('a list names facet keys and cannot claim', () => {
    expect(check(fill({}, { open: { target: 'row', list: { facets: ['binCode'], role: 'binning' } } }))).not.toThrow();
    expect(check(fill({}, { open: { target: 'row', list: { facets: [] } } }))).toThrow(/non-empty array of facet keys/);
    expect(check(fill({}, { open: { target: 'row', list: { facets: ['bad key'] } } }))).toThrow(/facet keys/);
    expect(check(fill({}, { open: { target: 'row', list: { facets: ['binCode'] }, claim: true } }))).toThrow(/a row, not a list/);
  });
});

describe('hold release and all-in', () => {
  it('names the release button, its tone and where it returns', () => {
    expect(check(hold({ release: { label: "I'm done", tone: 'accent', return: 'home' } }))).not.toThrow();
    expect(check(hold({ release: { return: '/escalations/available' } }))).not.toThrow();
    expect(check(hold({ release: { tone: 'loud' } }))).toThrow(/tone must be 'neutral' or 'accent'/);
    expect(check(hold({ release: { return: 'elsewhere' } }))).toThrow(/return must be 'home' or a dashboard-relative route/);
  });

  it('whenAllIn needs the roster it watches', () => {
    expect(check(hold({ whenAllIn: { markdown: 'All in.', afterSeconds: 5 } }))).not.toThrow();
    expect(check(hold({ show: undefined, whenAllIn: { markdown: 'All in.' } }))).toThrow(/whenAllIn requires params.hold.show/);
  });
});

describe('present show', () => {
  it('names a roster field, on present steps only', () => {
    expect(check(present({ show: 'roster' }))).not.toThrow();
    expect(check(present({ show: 'not a field' }))).toThrow(/show must name a roster field/);
    expect(check(fill({}, { show: 'roster' }))).toThrow(/show applies only to present steps/);
  });
});

describe('fill prefer', () => {
  it('names a map on the row and needs the held subject', () => {
    expect(check(fill({ prefer: 'envelope.key_owners' }))).not.toThrow();
    expect(check(fill({ prefer: 'key_owners' }))).toThrow(/prefer must name a map on the row/);
    expect(check(fill({ into: 'scanned', prefer: 'envelope.key_owners' }, { subject: undefined }))).toThrow(/needs into: 'subject'/);
  });
});

describe('{located.…}', () => {
  it('reads only in refusal and done copy', () => {
    expect(check(fill({}, { refuse: { markdown: 'This one is at {located.roleTitle}.' } }))).not.toThrow();
    expect(check(fill({ payload: { at: '{located.role}' } }))).toThrow(/readable only in refusal or done copy/);
  });
});
