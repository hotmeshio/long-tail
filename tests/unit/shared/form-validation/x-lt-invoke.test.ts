import { describe, it, expect } from 'vitest';
import {
  INVOKE_VARIANTS,
  interpolateInvokeValue,
  readInvokeConfig,
  resolveInvokePayload,
} from '../../../../shared/form-validation/x-lt-invoke';
import { mapFormToPayload, validateResolverForm } from '../../../../shared/form-validation';

const CTX = {
  escalation: { id: 'esc-1', role: 'printer-fleet', status: 'pending' },
  metadata: { orderId: 'ORD-9', copies: 2, rush: true, blank: '', nothing: null },
  envelope: { tags: ['a', 'b'] },
  resolver: { notes: 'typed' },
};

describe('readInvokeConfig', () => {
  it('returns null when the field declares nothing usable', () => {
    expect(readInvokeConfig(undefined)).toBeNull();
    expect(readInvokeConfig({})).toBeNull();
    expect(readInvokeConfig({ 'x-lt-invoke': 'printPamphlet' })).toBeNull();
    expect(readInvokeConfig({ 'x-lt-invoke': {} })).toBeNull();
    expect(readInvokeConfig({ 'x-lt-invoke': { workflow: '   ' } })).toBeNull();
  });

  it('applies defaults for a bare workflow declaration', () => {
    expect(readInvokeConfig({ 'x-lt-invoke': { workflow: ' printPamphlet ' } })).toEqual({
      workflow: 'printPamphlet',
      data: {},
      metadata: {},
      modal: false,
      confirm: null,
      variant: INVOKE_VARIANTS.LINK,
      icon: true,
    });
  });

  it('reads every declared option and ignores malformed ones', () => {
    const cfg = readInvokeConfig({
      'x-lt-invoke': {
        workflow: 'printPamphlet',
        data: { order: { id: '{{metadata.orderId}}' } },
        metadata: { escalationId: '{{escalation.id}}' },
        modal: true,
        confirm: 'Print?',
        variant: 'button',
        icon: false,
      },
    });
    expect(cfg).toMatchObject({ modal: true, confirm: 'Print?', variant: INVOKE_VARIANTS.BUTTON, icon: false });
    expect(cfg?.data).toEqual({ order: { id: '{{metadata.orderId}}' } });
    expect(cfg?.metadata).toEqual({ escalationId: '{{escalation.id}}' });

    const loose = readInvokeConfig({
      'x-lt-invoke': { workflow: 'w', data: 'nope', metadata: [1], modal: 'yes', confirm: '  ', variant: 'pill' },
    });
    expect(loose).toMatchObject({ data: {}, metadata: {}, modal: false, confirm: null, variant: INVOKE_VARIANTS.LINK, icon: true });
  });
});

describe('interpolateInvokeValue', () => {
  it('a whole-token leaf keeps the type of the context value', () => {
    expect(interpolateInvokeValue('{{metadata.copies}}', CTX)).toBe(2);
    expect(interpolateInvokeValue('{{metadata.rush}}', CTX)).toBe(true);
    expect(interpolateInvokeValue('{{ metadata.orderId }}', CTX)).toBe('ORD-9');
    expect(interpolateInvokeValue('{{envelope.tags}}', CTX)).toEqual(['a', 'b']);
  });

  it('a whole-token leaf with no value resolves to undefined', () => {
    expect(interpolateInvokeValue('{{metadata.missing}}', CTX)).toBeUndefined();
    expect(interpolateInvokeValue('{{metadata.nothing}}', CTX)).toBeUndefined();
    expect(interpolateInvokeValue('{{payload.x}}', CTX)).toBeUndefined();
  });

  it('a mixed leaf becomes a string, or drops when any segment is missing', () => {
    expect(interpolateInvokeValue('order-{{metadata.orderId}}-x{{metadata.copies}}', CTX)).toBe('order-ORD-9-x2');
    expect(interpolateInvokeValue('order-{{metadata.missing}}', CTX)).toBeUndefined();
    expect(interpolateInvokeValue('order-{{metadata.blank}}', CTX)).toBeUndefined();
  });

  it('plain leaves pass through and structures recurse, dropping unresolved keys', () => {
    const template = {
      copies: 1,
      flag: false,
      note: 'plain',
      order: { id: '{{metadata.orderId}}', ref: '{{metadata.missing}}' },
      list: ['{{metadata.copies}}', '{{metadata.missing}}', 'x'],
      from: '{{resolver.notes}}',
    };
    expect(interpolateInvokeValue(template, CTX)).toEqual({
      copies: 1,
      flag: false,
      note: 'plain',
      order: { id: 'ORD-9' },
      list: [2, 'x'],
      from: 'typed',
    });
  });

  it('tolerates an absent context', () => {
    expect(interpolateInvokeValue({ id: '{{metadata.orderId}}', n: 1 }, undefined)).toEqual({ n: 1 });
  });
});

describe('resolveInvokePayload', () => {
  it('resolves data and metadata independently', () => {
    const cfg = readInvokeConfig({
      'x-lt-invoke': {
        workflow: 'printPamphlet',
        data: { order: { id: '{{metadata.orderId}}' }, copies: '{{metadata.copies}}' },
        metadata: { escalationId: '{{escalation.id}}', source: 'form' },
      },
    })!;
    expect(resolveInvokePayload(cfg, CTX)).toEqual({
      data: { order: { id: 'ORD-9' }, copies: 2 },
      metadata: { escalationId: 'esc-1', source: 'form' },
    });
  });
});

describe('an invoke field inside a form schema', () => {
  const SCHEMA = {
    required: ['notes'],
    properties: {
      notes: { type: 'string', 'x-lt-bind': 'review.notes' },
      queue_link: { type: 'string', readOnly: true, 'x-lt-widget': 'link', 'x-lt-href': '/x' },
      print: {
        type: 'string',
        readOnly: true,
        'x-lt-widget': 'invoke',
        'x-lt-invoke': { workflow: 'printPamphlet' },
      },
    },
  };

  it('is validation-inert', () => {
    expect(validateResolverForm(SCHEMA, { notes: 'ok', queue_link: '', print: '' })).toEqual([]);
    expect(validateResolverForm(SCHEMA, { notes: '', queue_link: '', print: '' }).map((e) => e.field)).toEqual(['notes']);
  });

  it('is dropped from the submitted payload along with the other display-only widgets', () => {
    expect(mapFormToPayload({ notes: 'ok', queue_link: '', print: '' }, SCHEMA)).toEqual({ review: { notes: 'ok' } });
  });
});
