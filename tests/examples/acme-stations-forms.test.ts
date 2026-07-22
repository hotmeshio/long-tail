import { describe, it, expect } from 'vitest';

import { validateResolverForm, mapFormToPayload } from '../../shared/form-validation';
import {
  ACME_QA_FORM_SCHEMA,
  ACME_ADDONS_FORM_SCHEMA,
  AcmeQaResolverV1Schema,
  AcmeAddonsResolverV1Schema,
} from '../../examples/workflows/acme-stations/forms';

// The perfect-form contract: one explicit decision gates two conditional
// surfaces; hidden requirements never block; the bind map produces the nested
// resolver payload the workflow's zod contract accepts.

const QA = ACME_QA_FORM_SCHEMA as unknown as Record<string, any>;
const ADDONS = ACME_ADDONS_FORM_SCHEMA as unknown as Record<string, any>;

const qaCtx = {
  envelope: {
    checklist_items: [
      { id: 'counts', label: 'Counts match' },
      { id: 'strings', label: 'No strings' },
    ],
    reject_reason_items: [{ id: 'warping', label: 'Warping' }],
    maxRejectLeft: 2,
    maxRejectRight: 2,
  },
} as Record<string, unknown>;

const QA_FACTS = {
  po: 'ACME-1042',
  orderId: 'ord-8127',
  leftQuantity: '2',
  rightQuantity: '2',
  orthoticType: 'Functional',
  shoeSize: 'M10',
  material: 'polymax',
  certified: 'false',
};

describe('acme-print-qa form', () => {
  it('blocks until the decision is made (Choose… state)', () => {
    const errors = validateResolverForm(QA, { ...QA_FACTS, outcome: '', notes: '' }, qaCtx);
    expect(errors.map((e) => e.field)).toContain('outcome');
  });

  it('Pass path: complete checklist passes; hidden report fields never block', () => {
    const form = {
      ...QA_FACTS,
      outcome: 'Pass',
      checks: { counts: true, strings: true },
      rejectReason: '',
      notes: '',
    };
    expect(validateResolverForm(QA, form, { ...qaCtx, resolver: form })).toEqual([]);
  });

  it('Pass path: an incomplete required-all checklist blocks', () => {
    const form = {
      ...QA_FACTS,
      outcome: 'Pass',
      checks: { counts: true, strings: false },
      rejectReason: '',
      notes: '',
    };
    const errors = validateResolverForm(QA, form, { ...qaCtx, resolver: form });
    expect(errors.map((e) => e.field)).toContain('checks');
  });

  it('Reject path: requires the written reason and caps counts at the order quantities', () => {
    const form = {
      ...QA_FACTS,
      outcome: 'Reject',
      rejectReason: 'short',
      rejectLeftQuantity: 3,
      rejectRightQuantity: 1,
      sendBackTo: 'Printing',
      notes: '',
    };
    const fields = validateResolverForm(QA, form, { ...qaCtx, resolver: form }).map((e) => e.field);
    expect(fields).toContain('rejectReason');
    expect(fields).toContain('rejectLeftQuantity');
    expect(fields).not.toContain('rejectRightQuantity');
  });

  it('maps the flat submission into the nested resolver contract', () => {
    const form = {
      outcome: 'Reject',
      rejectReasons: { warping: true },
      rejectReason: 'Warping across the medial edge on both pieces.',
      rejectLeftQuantity: 1,
      rejectRightQuantity: 0,
      sendBackTo: 'Printing',
      notes: 'Second occurrence this week.',
    };
    const payload = mapFormToPayload(form, QA);
    const parsed = AcmeQaResolverV1Schema.parse(payload);
    expect(parsed.outcome).toBe('Reject');
    expect(parsed.report?.reason).toContain('Warping');
    expect(parsed.report?.left).toBe(1);
    expect(parsed.report?.sendBackTo).toBe('Printing');
  });
});

describe('acme-addons form', () => {
  const addonsCtx = {
    envelope: {
      checklist_items: [
        { id: 'attached', label: 'Every addon attached' },
        { id: 'angles', label: 'Angles verified' },
      ],
      custom_items: [
        { id: 'wedge_medial', label: 'Wedge — medial, left' },
        { id: 'met_pad', label: 'Met pad — standard' },
      ],
      reject_reason_items: [{ id: 'damage', label: 'Handling damage' }],
    },
  } as Record<string, unknown>;

  it('Complete path: pre-checked standard items plus clicked custom work passes', () => {
    const form = {
      po: 'ACME-1042',
      orderId: 'ord-8127',
      outcome: 'Complete',
      checks: { attached: true, angles: true },
      customChecks: { wedge_medial: true, met_pad: true },
      rejectReason: '',
      notes: '',
    };
    expect(validateResolverForm(ADDONS, form, { ...addonsCtx, resolver: form })).toEqual([]);
  });

  it('Complete path: unclicked custom work blocks — those clicks are the record', () => {
    const form = {
      outcome: 'Complete',
      checks: { attached: true, angles: true },
      customChecks: { wedge_medial: true, met_pad: false },
      rejectReason: '',
      notes: '',
    };
    const errors = validateResolverForm(ADDONS, form, { ...addonsCtx, resolver: form });
    expect(errors.map((e) => e.field)).toContain('customChecks');
  });

  it('maps a completion into the nested resolver contract', () => {
    const form = {
      outcome: 'Complete',
      checks: { attached: true, angles: true },
      customChecks: { wedge_medial: true, met_pad: true },
      notes: '',
    };
    const parsed = AcmeAddonsResolverV1Schema.parse(mapFormToPayload(form, ADDONS));
    expect(parsed.outcome).toBe('Complete');
    expect(parsed.customChecks).toEqual({ wedge_medial: true, met_pad: true });
  });

  it('a Complete submission carrying hidden report defaults parses clean', () => {
    // Hidden conditional fields ride the submission with their defaults —
    // '' for untouched text/checklists, [''] for the empty upload slot.
    const form = {
      outcome: 'Complete',
      checks: { attached: true, angles: true },
      customChecks: { wedge_medial: true, met_pad: true },
      rejectReasons: '',
      rejectReason: '',
      sendBackTo: 'Printing',
      rejectPhoto: '',
      notes: '',
    };
    const parsed = AcmeAddonsResolverV1Schema.parse(mapFormToPayload(form, ADDONS));
    expect(parsed.outcome).toBe('Complete');
    expect(parsed.report?.reasons).toBeUndefined();
    expect(parsed.report?.reason).toBeUndefined();
    expect(parsed.report?.photos ?? []).toEqual([]);
  });
});
