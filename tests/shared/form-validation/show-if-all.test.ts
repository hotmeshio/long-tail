import { describe, it, expect } from 'vitest';
import { evaluateShowIf } from '../../../shared/form-validation/x-lt-show-if';
import { validateResolverForm } from '../../../shared/form-validation/validate-resolver-payload';

// An array of conditions shows the field only when every one holds.
const ctx = { input: { action: 'report-offline', powerCycled: false } };

describe('x-lt-showIf with several conditions', () => {
  it('all must hold', () => {
    expect(evaluateShowIf(['input.action=report-offline', '!input.powerCycled'], ctx)).toBe(true);
    expect(evaluateShowIf(['input.action=retire', '!input.powerCycled'], ctx)).toBe(false);
    expect(evaluateShowIf(['input.action=report-offline', 'input.powerCycled'], ctx)).toBe(false);
  });

  it('an empty array shows, like an absent condition', () => {
    expect(evaluateShowIf([], ctx)).toBe(true);
  });

  it('the validation pass skips a field hidden by the array', () => {
    const schema = {
      required: ['lastSeenAt'],
      properties: {
        action: { type: 'string' },
        lastSeenAt: { type: 'string', 'x-lt-showIf': ['input.action=report-offline', '!input.powerCycled'] },
      },
    };
    expect(validateResolverForm(schema, { action: 'retire' })).toEqual([]);
    expect(validateResolverForm(schema, { action: 'report-offline' }).map((e) => e.field)).toEqual(['lastSeenAt']);
  });
});
