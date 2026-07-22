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
      { id: 'burrs', label: 'No burrs' },
    ],
    reject_reason_items: [{ id: 'warping', label: 'Warping' }],
    maxRejectLeft: 2,
    maxRejectRight: 2,
  },
} as Record<string, unknown>;

const QA_FACTS = {
  po: 'ACME-1042',
  widgetId: 'wgt-8127',
  leftQuantity: '2',
  rightQuantity: '2',
  widgetType: 'Standard',
  sizeCode: 'S2',
  material: 'alloy',
  certified: 'false',
};

describe('acme-final-qa form', () => {
  it('blocks until the decision is made (Choose… state)', () => {
    const errors = validateResolverForm(QA, { ...QA_FACTS, outcome: '', notes: '' }, qaCtx);
    expect(errors.map((e) => e.field)).toContain('outcome');
  });

  it('Pass path: complete checklist passes; hidden report fields never block', () => {
    const form = {
      ...QA_FACTS,
      outcome: 'Pass',
      checks: { counts: true, burrs: true },
      rejectReason: '',
      notes: '',
    };
    expect(validateResolverForm(QA, form, { ...qaCtx, resolver: form })).toEqual([]);
  });

  it('Pass path: an incomplete required-all checklist blocks', () => {
    const form = {
      ...QA_FACTS,
      outcome: 'Pass',
      checks: { counts: true, burrs: false },
      rejectReason: '',
      notes: '',
    };
    const errors = validateResolverForm(QA, form, { ...qaCtx, resolver: form });
    expect(errors.map((e) => e.field)).toContain('checks');
  });

  it('Reject path: requires the written reason and caps counts at the run quantities', () => {
    const form = {
      ...QA_FACTS,
      outcome: 'Reject',
      rejectReasons: { warping: true },
      rejectReason: 'short',
      rejectLeftQuantity: 3,
      rejectRightQuantity: 1,
      sendBackTo: 'Fabrication',
      notes: '',
    };
    const fields = validateResolverForm(QA, form, { ...qaCtx, resolver: form }).map((e) => e.field);
    expect(fields).toContain('rejectReason');
    expect(fields).toContain('rejectLeftQuantity');
    expect(fields).not.toContain('rejectRightQuantity');
  });

  it('Reject path: a report with zero reasons blocks — at least one is required', () => {
    const form = {
      ...QA_FACTS,
      outcome: 'Reject',
      rejectReasons: {},
      rejectReason: 'Warping across the outer edge on both widgets.',
      rejectLeftQuantity: 1,
      rejectRightQuantity: 0,
      sendBackTo: 'Fabrication',
      notes: '',
    };
    const fields = validateResolverForm(QA, form, { ...qaCtx, resolver: form }).map((e) => e.field);
    expect(fields).toContain('rejectReasons');
  });

  it('maps the flat submission into the nested resolver contract', () => {
    const form = {
      outcome: 'Reject',
      rejectReasons: { warping: true },
      rejectReason: 'Warping across the outer edge on both widgets.',
      rejectLeftQuantity: 1,
      rejectRightQuantity: 0,
      sendBackTo: 'Fabrication',
      notes: 'Second occurrence this week.',
    };
    const payload = mapFormToPayload(form, QA);
    const parsed = AcmeQaResolverV1Schema.parse(payload);
    expect(parsed.outcome).toBe('Reject');
    expect(parsed.report?.reason).toContain('Warping');
    expect(parsed.report?.left).toBe(1);
    expect(parsed.report?.sendBackTo).toBe('Fabrication');
  });
});

describe('acme-addons form', () => {
  const addonsCtx = {
    envelope: {
      checklist_items: [
        { id: 'attached', label: 'Every addon attached' },
        { id: 'alignment', label: 'Alignment verified' },
      ],
      custom_items: [
        { id: 'mount_front', label: 'Mount — front, left' },
        { id: 'gasket_std', label: 'Gasket — standard' },
      ],
      reject_reason_items: [{ id: 'damage', label: 'Handling damage' }],
    },
  } as Record<string, unknown>;

  it('Complete path: pre-checked standard items plus clicked custom work passes', () => {
    const form = {
      po: 'ACME-1042',
      widgetId: 'wgt-8127',
      outcome: 'Complete',
      checks: { attached: true, alignment: true },
      customChecks: { mount_front: true, gasket_std: true },
      rejectReason: '',
      notes: '',
    };
    expect(validateResolverForm(ADDONS, form, { ...addonsCtx, resolver: form })).toEqual([]);
  });

  it('Complete path: unclicked custom work blocks — those clicks are the record', () => {
    const form = {
      outcome: 'Complete',
      checks: { attached: true, alignment: true },
      customChecks: { mount_front: true, gasket_std: false },
      rejectReason: '',
      notes: '',
    };
    const errors = validateResolverForm(ADDONS, form, { ...addonsCtx, resolver: form });
    expect(errors.map((e) => e.field)).toContain('customChecks');
  });

  it('maps a completion into the nested resolver contract', () => {
    const form = {
      outcome: 'Complete',
      checks: { attached: true, alignment: true },
      customChecks: { mount_front: true, gasket_std: true },
      notes: '',
    };
    const parsed = AcmeAddonsResolverV1Schema.parse(mapFormToPayload(form, ADDONS));
    expect(parsed.outcome).toBe('Complete');
    expect(parsed.customChecks).toEqual({ mount_front: true, gasket_std: true });
  });

  it('a Complete submission carrying hidden report defaults parses clean', () => {
    // Hidden conditional fields ride the submission with their defaults —
    // '' for untouched text/checklists, [''] for the empty upload slot.
    const form = {
      outcome: 'Complete',
      checks: { attached: true, alignment: true },
      customChecks: { mount_front: true, gasket_std: true },
      rejectReasons: '',
      rejectReason: '',
      sendBackTo: 'Fabrication',
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
