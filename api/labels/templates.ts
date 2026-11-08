import * as labels from '../../services/labels';
import { labelTransportRegistry } from '../../lib/labels/transports';
import type { LTApiResult } from '../../types/sdk';
import type { LabelTemplateInput } from '../../types/labels';
import { labelFailure } from './errors';

/**
 * List label templates, optionally for one scan scheme.
 *
 * @param input.scheme — scheme version to filter by
 * @returns `{ status: 200, data: { templates } }`
 */
export async function listLabelTemplates(input: { scheme?: number } = {}): Promise<LTApiResult> {
  try {
    return { status: 200, data: { templates: await labels.listLabelTemplates(input.scheme) } };
  } catch (err) {
    return labelFailure(err);
  }
}

/** One label template by name; 404 when absent. */
export async function getLabelTemplate(input: { name: string }): Promise<LTApiResult> {
  try {
    const template = await labels.getLabelTemplate(input.name);
    return template ? { status: 200, data: template } : { status: 404, error: 'Label template not found' };
  } catch (err) {
    return labelFailure(err);
  }
}

/**
 * Create or replace a label template. With `expected_revision`, the write
 * lands only on that revision (409 otherwise).
 */
export async function upsertLabelTemplate(input: LabelTemplateInput & { expected_revision?: number }): Promise<LTApiResult> {
  try {
    const { expected_revision, ...template } = input;
    return { status: 200, data: await labels.upsertLabelTemplate(template, expected_revision) };
  } catch (err) {
    return labelFailure(err);
  }
}

export async function deleteLabelTemplate(input: { name: string }): Promise<LTApiResult> {
  try {
    const deleted = await labels.deleteLabelTemplate(input.name);
    return deleted ? { status: 200, data: { deleted: true } } : { status: 404, error: 'Label template not found' };
  } catch (err) {
    return labelFailure(err);
  }
}

/** Media presets and the deployment's default. */
export async function listLabelMedia(): Promise<LTApiResult> {
  return { status: 200, data: { media: labels.labelMediaPresets(), defaultMedia: labels.defaultLabelMediaId() } };
}

/** Registered printer transports by name. */
export async function listLabelTransports(): Promise<LTApiResult> {
  return { status: 200, data: { transports: labelTransportRegistry.list() } };
}
