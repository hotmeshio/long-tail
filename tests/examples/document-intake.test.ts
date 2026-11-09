import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const upload = vi.fn();
vi.mock('../../sdk', () => ({ createClient: () => ({ files: { upload } }) }));

import { extractApplication, recordReview, stageSampleDocuments } from '../../examples/workflows/document-intake/activities';
import { INTAKE_FORM_SCHEMA, type IntakeReviewV1 } from '../../examples/workflows/document-intake/forms';
import { buildApplicationPdf, SAMPLE_APPLICANT } from '../../examples/workflows/document-intake/sample-documents';
import { buildFormReview, readConfidenceSpec } from '../../shared/form-validation/x-lt-confidence';
import { mapPayloadToForm } from '../../shared/form-validation/x-lt-bind';
import { assertFileRefs } from '../../types/escalation';

const VERIFIED: IntakeReviewV1 = {
  applicant: {
    first_name: SAMPLE_APPLICANT.first_name,
    last_name: SAMPLE_APPLICANT.last_name,
    date_of_birth: SAMPLE_APPLICANT.date_of_birth,
    email: SAMPLE_APPLICANT.email,
    phone: SAMPLE_APPLICANT.phone,
  },
  account_type: 'joint',
  address: { street: SAMPLE_APPLICANT.street, city: SAMPLE_APPLICANT.city, postal_code: SAMPLE_APPLICANT.postal_code },
  id_matches: 'yes',
};

beforeEach(() => {
  upload.mockReset();
  upload.mockResolvedValue({ status: 200, data: {} });
});

describe('document-intake example', () => {
  it('stores both documents through the SDK and names them as valid file refs', async () => {
    const refs = await stageSampleDocuments('APP-7');
    expect(() => assertFileRefs(refs)).not.toThrow();
    expect(refs.map((r) => r.as)).toEqual(['application', 'id_card']);
    expect(upload.mock.calls.map(([arg]) => arg.path)).toEqual([
      'examples/document-intake/APP-7/application.pdf',
      'examples/document-intake/APP-7/id-card.svg',
    ]);
  });

  it('fails loudly when storage refuses a document', async () => {
    upload.mockResolvedValueOnce({ status: 500, error: 'bucket unavailable' });
    await expect(stageSampleDocuments('APP-8')).rejects.toThrow(/bucket unavailable/);
  });

  it('builds a one-page application PDF', async () => {
    const pdf = await PDFDocument.load(await buildApplicationPdf('APP-9'));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('proposes a value for every editable field, scored into the form\'s tranches', async () => {
    const { values, confidence } = await extractApplication('APP-1');
    const spec = readConfidenceSpec(INTAKE_FORM_SCHEMA)!;
    const form = mapPayloadToForm(values, INTAKE_FORM_SCHEMA);
    const review = buildFormReview(spec, INTAKE_FORM_SCHEMA, { envelope: { formDefaults: values, confidence } }, form);
    expect(Object.keys(review).sort()).toEqual([
      'account_type', 'city', 'date_of_birth', 'email', 'first_name', 'last_name', 'phone', 'postal_code', 'street',
    ]);
    expect(review.first_name.tranche?.label).toBe('Low');
    expect(review.postal_code.tranche?.label).toBe('Check');
    expect(review.city.tranche).toBeUndefined();
    expect(Object.values(review).every((r) => !r.changed)).toBe(true);
  });

  it('records each value the reviewer corrected', async () => {
    const { values } = await extractApplication('APP-1');
    const result = await recordReview({ proposed: values, review: VERIFIED });
    expect(result.accepted).toBe(true);
    expect(result.corrections.map((c) => c.path).sort()).toEqual([
      'account_type', 'applicant.date_of_birth', 'applicant.first_name',
    ]);
    expect(result.corrections.find((c) => c.path === 'applicant.first_name')).toEqual({
      path: 'applicant.first_name', proposed: 'Jon', final: 'John',
    });
    expect(result.proposedCount).toBe(9);
  });

  it('gives every input a title and one instruction line', () => {
    for (const [key, def] of Object.entries(INTAKE_FORM_SCHEMA.properties)) {
      expect((def as Record<string, unknown>).title, key).toBeTruthy();
      expect((def as Record<string, unknown>).description, key).toBeTruthy();
    }
  });
});
