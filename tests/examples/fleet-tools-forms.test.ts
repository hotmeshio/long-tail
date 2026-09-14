import { describe, it, expect } from 'vitest';

import { validateResolverForm, validateResolverPayload, mapFormToPayload, buildInvokeFormContext, evaluateShowIf } from '../../shared/form-validation';
import { FLEET_TOOLS_INPUT_SCHEMA, FLEET_TOOL_ACTIONS } from '../../examples/workflows/fleet-tools/forms';

// The invoke-form contract: the tool decision gates every other field, hidden
// requirements never block, and the bind map yields the nested payload the
// workflow reads. The same pass runs in the dashboard and in the invoke gate.

const SCHEMA = FLEET_TOOLS_INPUT_SCHEMA as unknown as Record<string, any>;
const ctx = buildInvokeFormContext({ source: 'dashboard' });

const fields = (errors: { field: string }[]) => errors.map((e) => e.field);

describe('fleetTools input schema', () => {
  it('an empty form asks only for the two ungated fields', () => {
    expect(fields(validateResolverForm(SCHEMA, {}, ctx))).toEqual(['serialNumber', 'action']);
  });

  it('a serial outside the pattern is refused with the authored message', () => {
    const errors = validateResolverForm(SCHEMA, { serialNumber: 'BAD SERIAL', action: FLEET_TOOL_ACTIONS.RETIRE, reason: 'sold', confirm: true }, ctx);
    expect(errors).toEqual([{ field: 'serialNumber', message: 'Lowercase letters, digits, and dashes only' }]);
  });

  it('each tool requires only its own knobs', () => {
    const base = { serialNumber: 'printer-07' };
    expect(fields(validateResolverForm(SCHEMA, { ...base, action: FLEET_TOOL_ACTIONS.REPRINT_LABEL, copies: 0 }, ctx)))
      .toEqual(['copies', 'labelKind']);
    expect(fields(validateResolverForm(SCHEMA, { ...base, action: FLEET_TOOL_ACTIONS.CHANGE_FILAMENT, spoolCount: 2 }, ctx)))
      .toEqual(['filamentType']);
    expect(fields(validateResolverForm(SCHEMA, { ...base, action: FLEET_TOOL_ACTIONS.REPORT_OFFLINE }, ctx)))
      .toEqual(['lastSeenAt']);
    expect(fields(validateResolverForm(SCHEMA, { ...base, action: FLEET_TOOL_ACTIONS.RETIRE, confirm: true }, ctx)))
      .toEqual(['reason']);
  });

  it('a complete retirement binds into the nested payload the workflow reads', () => {
    const form = { serialNumber: 'printer-07', action: FLEET_TOOL_ACTIONS.RETIRE, reason: 'end-of-life', confirm: true };
    expect(validateResolverForm(SCHEMA, form, ctx)).toEqual([]);
    const payload = mapFormToPayload(form, SCHEMA);
    expect(payload).toEqual({
      printer: { serialNumber: 'printer-07' },
      tool: { action: 'retire', details: { reason: 'end-of-life', confirm: true } },
    });
    expect(validateResolverPayload(SCHEMA, payload, ctx)).toEqual([]);
  });

  it('the server pass rejects a payload the form would reject', () => {
    const payload = { printer: { serialNumber: 'printer-07' }, tool: { action: 'reprint-label', details: { copies: 9, labelKind: 'bag' } } };
    expect(fields(validateResolverPayload(SCHEMA, payload, ctx))).toEqual(['copies']);
  });

  it('the power-cycle prompt belongs to the offline tool and shows only while the box is unticked', () => {
    const prompt = SCHEMA.properties.powerCycleFirst;
    expect(prompt['x-lt-showIf']).toEqual(['input.action=report-offline', '!input.powerCycled']);
    expect(prompt.readOnly).toBe(true);
    expect(prompt['x-lt-widget']).toBe('markdown');
    expect(evaluateShowIf(prompt['x-lt-showIf'], { input: { action: 'retire', powerCycled: false } })).toBe(false);
    expect(evaluateShowIf(prompt['x-lt-showIf'], { input: { action: 'report-offline', powerCycled: false } })).toBe(true);
    expect(evaluateShowIf(prompt['x-lt-showIf'], { input: { action: 'report-offline', powerCycled: true } })).toBe(false);
  });
});
