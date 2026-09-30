import { describe, it, expect } from 'vitest';

import { evaluateShowIf } from '../../../shared/form-validation/x-lt-show-if';
import { HELP_DOMAINS } from '../../../shared/form-validation/x-lt-help';

// A condition over a domain forms do not carry shows its field, so form
// validation and rendering never hide a field on a token they cannot read.
describe('x-lt-show-if over an unknown domain', () => {
  it('item is not a form token domain', () => {
    expect(HELP_DOMAINS as readonly string[]).not.toContain('item');
  });

  it('shows the field for truthy, negated and equality forms', () => {
    const ctx = { metadata: { lane: 'a' } };
    expect(evaluateShowIf('item.payload.code', ctx)).toBe(true);
    expect(evaluateShowIf('!item.payload.code', ctx)).toBe(true);
    expect(evaluateShowIf('item.payload.code=VC531C38', ctx)).toBe(true);
  });
});
