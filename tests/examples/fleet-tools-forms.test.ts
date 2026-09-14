import { describe, it, expect } from 'vitest';

import { validateResolverForm, validateResolverPayload, mapFormToPayload, buildInvokeFormContext, evaluateShowIf } from '../../shared/form-validation';
import { FLEET_TOOLS_INPUT_SCHEMA, FLEET_TOOL_ACTIONS, FLEET_SERIALS_LOOKUP, FLEET_MATERIALS_LOOKUP } from '../../examples/workflows/fleet-tools/forms';
import { FLEET_MATERIALS, fleetSerialOptions } from '../../examples/seed-fleet-tools';

const FLEET_SERIAL_ITEMS = fleetSerialOptions([
  { facets: { serialNumber: 'printer-07', facility: 'south' } },
  { facets: { serialNumber: 'printer-01', facility: 'north' } },
  { facets: { serialNumber: 'printer-02', facility: 'north' } },
  { facets: { serialNumber: 'printer-12', facility: 'south' } },
]);

// The invoke-form contract: the tool decision gates every other field, hidden
// requirements never block, and the bind map yields the nested payload the
// workflow reads. The same pass runs in the dashboard and in the invoke gate.

const SCHEMA = FLEET_TOOLS_INPUT_SCHEMA as unknown as Record<string, any>;
const ctx = buildInvokeFormContext({ source: 'dashboard' }, {
  [FLEET_SERIALS_LOOKUP.as]: { items: FLEET_SERIAL_ITEMS },
  [FLEET_MATERIALS_LOOKUP.as]: FLEET_MATERIALS,
});

const fields = (errors: { field: string }[]) => errors.map((e) => e.field);

describe('fleetTools input schema', () => {
  it('an empty form asks only for the two ungated fields', () => {
    expect(fields(validateResolverForm(SCHEMA, {}, ctx))).toEqual(['serialNumber', 'action']);
  });

  it('a serial outside the pattern is refused with the authored message when no edition is pinned', () => {
    const noLookup = buildInvokeFormContext({ source: 'dashboard' });
    const errors = validateResolverForm(SCHEMA, { serialNumber: 'BAD SERIAL', action: FLEET_TOOL_ACTIONS.RETIRE, reason: 'sold', confirm: true }, noLookup);
    expect(errors).toEqual([{ field: 'serialNumber', message: 'Letters, digits, and dashes only' }]);
  });

  it('each tool requires only its own knobs', () => {
    const base = { serialNumber: 'printer-07' };
    expect(fields(validateResolverForm(SCHEMA, { ...base, action: FLEET_TOOL_ACTIONS.REPRINT_LABEL, copies: 0 }, ctx)))
      .toEqual(['copies', 'labelKind']);
    expect(fields(validateResolverForm(SCHEMA, { ...base, action: FLEET_TOOL_ACTIONS.CHANGE_FILAMENT, slots: ['slot-2'] }, ctx)))
      .toEqual(['filamentType', 'filamentColor']);
    expect(fields(validateResolverForm(SCHEMA, { ...base, action: FLEET_TOOL_ACTIONS.REPORT_OFFLINE }, ctx)))
      .toEqual(['lastSeenAt', 'powerCycled']);
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

describe('fleetTools richer shapes', () => {
  const base = { serialNumber: 'printer-07' };

  it('the serial select reads the pinned edition and refuses a serial outside it', () => {
    const errors = validateResolverForm(SCHEMA, { serialNumber: 'printer-99', action: FLEET_TOOL_ACTIONS.RETIRE, reason: 'sold', confirm: true }, ctx);
    expect(errors[0]).toMatchObject({ field: 'serialNumber' });
    expect(errors[0].message).toMatch(/^Must be one of: printer-01/);
  });

  it('without the edition the serial falls back to the pattern-guarded text input', () => {
    const noLookup = buildInvokeFormContext({ source: 'dashboard' });
    expect(validateResolverForm(SCHEMA, { serialNumber: 'printer-99', action: FLEET_TOOL_ACTIONS.RETIRE, reason: 'sold', confirm: true }, noLookup)).toEqual([]);
  });

  it('the label select carries inline labels and stores the value', () => {
    const payload = mapFormToPayload({ ...base, action: FLEET_TOOL_ACTIONS.REPRINT_LABEL, copies: 2, labelKind: 'plate' }, SCHEMA);
    expect(payload.tool.details.labelKind).toBe('plate');
    expect(fields(validateResolverPayload(SCHEMA, payload, ctx))).toEqual([]);
  });

  it('the power-cycle decision is a Yes/No boolean that must be answered', () => {
    const offline = { ...base, action: FLEET_TOOL_ACTIONS.REPORT_OFFLINE, lastSeenAt: '2026-09-13T10:30' };
    expect(fields(validateResolverForm(SCHEMA, { ...offline, powerCycled: null }, ctx))).toEqual(['powerCycled']);
    expect(fields(validateResolverForm(SCHEMA, { ...offline, powerCycled: false }, ctx))).toEqual([]);
  });

  it('slots is a multi-select bounded to the machine and readings a keyed map', () => {
    const filament = { ...base, action: FLEET_TOOL_ACTIONS.CHANGE_FILAMENT, filamentType: 'PLA', filamentColor: 'white' };
    expect(fields(validateResolverForm(SCHEMA, { ...filament, slots: [] }, ctx))).toEqual(['slots']);
    expect(validateResolverForm(SCHEMA, { ...filament, slots: ['slot-9'] }, ctx)[0].message).toBe('Must be one of: slot-1, slot-2, slot-3, slot-4');
    const offline = { ...base, action: FLEET_TOOL_ACTIONS.REPORT_OFFLINE, lastSeenAt: '2026-09-13T10:30', powerCycled: true };
    expect(validateResolverForm(SCHEMA, { ...offline, readings: { pressure: 1 } }, ctx)[0].message).toBe('Unknown key "pressure". Allowed: temperature, humidity, voltage');
    expect(validateResolverForm(SCHEMA, { ...offline, readings: { voltage: -1 } }, ctx)[0].message).toBe('"voltage": Minimum value is 0');
    expect(validateResolverForm(SCHEMA, { ...offline, readings: '{"volt' }, ctx)[0].message).toBe('Invalid JSON');
    expect(validateResolverForm(SCHEMA, { ...offline, readings: { voltage: 12 } }, ctx)).toEqual([]);
  });
});

describe('fleetTools catalog cascade, clearable priority, and json list', () => {
  const base = { serialNumber: 'printer-07' };

  it('the color list follows the material through the pinned catalog and fails closed before a pick', () => {
    const filament = { ...base, action: FLEET_TOOL_ACTIONS.CHANGE_FILAMENT, slots: ['slot-1'] };
    expect(validateResolverForm(SCHEMA, { ...filament, filamentType: '', filamentColor: 'white' }, ctx).map((e) => e.message))
      .toContain('No valid options for this selection');
    expect(validateResolverForm(SCHEMA, { ...filament, filamentType: 'PLA', filamentColor: 'clear' }, ctx)[0].message)
      .toBe('Must be one of: white, black, grey');
    expect(validateResolverForm(SCHEMA, { ...filament, filamentType: 'PETG', filamentColor: 'smoke' }, ctx)).toEqual([]);
  });

  it('priority is a clearable optional select: unset, null, or a listed value all pass', () => {
    const reprint = { ...base, action: FLEET_TOOL_ACTIONS.REPRINT_LABEL, copies: 1, labelKind: 'bag' };
    expect(SCHEMA.properties.priority['x-lt-nullable']).toBe(true);
    expect(validateResolverForm(SCHEMA, reprint, ctx)).toEqual([]);
    expect(validateResolverForm(SCHEMA, { ...reprint, priority: null }, ctx)).toEqual([]);
    expect(validateResolverForm(SCHEMA, { ...reprint, priority: 'rush' }, ctx)).toEqual([]);
    expect(validateResolverForm(SCHEMA, { ...reprint, priority: 'now' }, ctx)[0].field).toBe('priority');
  });

  it('removed parts is an optional json list checked per item', () => {
    const retire = { ...base, action: FLEET_TOOL_ACTIONS.RETIRE, reason: 'sold', confirm: true };
    expect(validateResolverForm(SCHEMA, { ...retire, removedParts: ['label', 'wheels'] }, ctx)[0].message)
      .toBe('Item 2: Must be one of: label, network-drop, spool-holder, build-plate');
    expect(validateResolverForm(SCHEMA, { ...retire, removedParts: '["label",' }, ctx)[0].message).toBe('Invalid JSON');
    expect(validateResolverForm(SCHEMA, { ...retire, removedParts: ['label', 'build-plate'] }, ctx)).toEqual([]);
    expect(validateResolverForm(SCHEMA, { ...retire, removedParts: [] }, ctx)).toEqual([]);
  });
});
