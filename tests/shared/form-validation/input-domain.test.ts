import { describe, it, expect } from 'vitest';
import { evaluateShowIf } from '../../../shared/form-validation/x-lt-show-if';
import { interpolateHelp, HELP_DOMAINS } from '../../../shared/form-validation/x-lt-help';
import { validateResolverPayload, validateResolverForm } from '../../../shared/form-validation/validate-resolver-payload';
import { buildInvokeFormContext } from '../../../shared/form-validation/invoke-context';

// `input` is the invoke-form name for the live values; `resolver` stays the
// escalation-form name. Both resolve to the same object everywhere.

const SCHEMA = {
  required: ['action', 'copies'],
  properties: {
    action: { type: 'string', enum: ['reprint-label', 'retire'], 'x-lt-bind': 'tool.action' },
    copies: { type: 'number', minimum: 1, 'x-lt-showIf': 'input.action=reprint-label' },
    reason: { type: 'string', 'x-lt-showIf': 'resolver.action=retire' },
  },
};

describe('input domain', () => {
  it('is a registered help domain', () => {
    expect(HELP_DOMAINS).toContain('input');
  });

  it('showIf reads input.* and resolver.* from the same live values', () => {
    const ctx = { input: { action: 'retire' }, resolver: { action: 'retire' } };
    expect(evaluateShowIf('input.action=retire', ctx)).toBe(true);
    expect(evaluateShowIf('resolver.action=retire', ctx)).toBe(true);
    expect(evaluateShowIf('input.action=reprint-label', ctx)).toBe(false);
  });

  it('help templates interpolate {{input.*}}', () => {
    expect(interpolateHelp('Serial {{input.serialNumber}}', { input: { serialNumber: 'sn-9' } })).toBe('Serial sn-9');
  });

  it('the validation pass publishes live values under both names', () => {
    expect(validateResolverForm(SCHEMA, { action: 'retire' }, buildInvokeFormContext(null))).toEqual([]);
    const errors = validateResolverForm(SCHEMA, { action: 'reprint-label' }, buildInvokeFormContext(null));
    expect(errors.map((e) => e.field)).toEqual(['copies']);
  });

  it('the nested-payload entry inverts x-lt-bind before evaluating input.* conditions', () => {
    expect(validateResolverPayload(SCHEMA, { tool: { action: 'retire' } }, buildInvokeFormContext({ source: 'dashboard' }))).toEqual([]);
    expect(validateResolverPayload(SCHEMA, { tool: { action: 'reprint-label' }, copies: 2 }, null)).toEqual([]);
  });

  it('the invoke context exposes metadata and nothing else', () => {
    expect(buildInvokeFormContext({ source: 'dashboard' })).toEqual({ metadata: { source: 'dashboard' } });
    expect(buildInvokeFormContext(undefined)).toEqual({ metadata: {} });
  });
});
