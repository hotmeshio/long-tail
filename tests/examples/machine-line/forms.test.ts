import { describe, it, expect } from 'vitest';

import { HANDOFF_FORM_SCHEMA, OPERATOR_FORM_SCHEMA } from '../../../examples/workflows/machine-line/forms';
import { validateResolverPayload } from '../../../shared/form-validation';

describe('machine line forms', () => {
  it('accepts every operator resolution the gateway sends', () => {
    for (const payload of [
      { decision: 'cleared', clearedBy: 'tech-9', note: 'cleared at press-01 by tech-9' },
      { decision: 'cleared', clearedBy: null, note: 'cleared at press-01' },
      { decision: 'restored', note: 'cut-01 back online' },
    ]) {
      expect(validateResolverPayload(OPERATOR_FORM_SCHEMA, payload)).toEqual([]);
    }
  });

  it('accepts a person deciding a failed handoff and refuses a missing or unknown decision', () => {
    expect(validateResolverPayload(OPERATOR_FORM_SCHEMA, { decision: 'retry', note: 'cleared the outfeed' })).toEqual([]);
    expect(validateResolverPayload(OPERATOR_FORM_SCHEMA, { note: 'no decision' })).not.toEqual([]);
    expect(validateResolverPayload(OPERATOR_FORM_SCHEMA, { decision: 'shrug' })).not.toEqual([]);
  });

  it('a person receiving units submits the handoff form', () => {
    expect(validateResolverPayload(HANDOFF_FORM_SCHEMA, { received: true, receiver: 'person-1' })).toEqual([]);
    expect(validateResolverPayload(HANDOFF_FORM_SCHEMA, {})).not.toEqual([]);
  });
});
