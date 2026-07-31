import { describe, it, expect } from 'vitest';
import { readFooterLabels } from '../../../../shared/form-validation/x-lt-labels';

describe('readFooterLabels', () => {
  it('returns an empty map when absent or not an object', () => {
    expect(readFooterLabels(null)).toEqual({});
    expect(readFooterLabels(undefined)).toEqual({});
    expect(readFooterLabels({})).toEqual({});
    expect(readFooterLabels({ 'x-lt-labels': 'nope' as unknown })).toEqual({});
    expect(readFooterLabels({ 'x-lt-labels': ['claim'] as unknown })).toEqual({});
  });

  it('reads the known targets', () => {
    expect(
      readFooterLabels({
        'x-lt-labels': {
          claim: 'Claim and Submit',
          cancel: 'Discard',
          submit: 'Approve',
          escalate: 'Send up',
          release: 'Hand back',
        },
      }),
    ).toEqual({
      claim: 'Claim and Submit',
      cancel: 'Discard',
      submit: 'Approve',
      escalate: 'Send up',
      release: 'Hand back',
    });
  });

  it('keeps only overridden targets and trims values', () => {
    expect(readFooterLabels({ 'x-lt-labels': { claim: '  Claim and Submit  ' } }))
      .toEqual({ claim: 'Claim and Submit' });
  });

  it('drops unknown keys and non-string or blank values', () => {
    expect(
      readFooterLabels({
        'x-lt-labels': { claim: 'Go', resolve: 'Nope', submit: 42, escalate: '   ' },
      }),
    ).toEqual({ claim: 'Go' });
  });
});
