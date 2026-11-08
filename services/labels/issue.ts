// Preview and issue label sheets. Issuing writes the ledger row before any
// code is composed, so a print the ledger does not hold never happens.

import { labelTransportRegistry } from '../../lib/labels/transports';
import { mayAdminister, mayIssueCredentials, mayManageRoles } from '../../modules/capabilities';
import { buildLabelSheet, LabelLayoutError } from '../../shared/labels/layout';
import { LabelMediaError } from '../../shared/labels/media';
import { renderSheetZpl, ZplRenderError } from '../../shared/labels/render-zpl';
import type { LabelSheet, LabelWarning } from '../../shared/labels/types';
import { SCAN_SCHEME_KINDS, type ScanRule, type ScanScheme } from '../../types';
import type { LTApiAuth } from '../../types/sdk';
import type { LabelIssueRequest, LabelJob, LabelLayoutRequest, LabelSource, LabelTarget, LabelTemplate } from '../../types/labels';
import type { LabelTransportReceipt } from '../../types/labels';
import { getScanScheme, listScanRules, listScanSchemes } from '../scan-code';
import { buildLabelContents } from './content';
import { LabelRequestError } from './errors';
import { claimLabelDelivery, markLabelDelivered, recordLabelJob, releaseLabelDelivery } from './jobs';
import { config } from '../../modules/config';
import { mediaForJob } from './media';
import { renderSheetPdf } from './render-pdf';
import { markResolvedTargets, resolveLabelTargets } from './targets';
import { getLabelTemplate } from './templates';
import { verifyLabels } from './verify';

export interface LabelPreview {
  template: LabelTemplate;
  sheet: LabelSheet;
  warnings: LabelWarning[];
  labelCount: number;
}

export interface LabelIssueResult {
  job: LabelJob;
  /** True when the idempotency key was used before: nothing printed again. */
  replay: boolean;
  warnings: LabelWarning[];
  sheet?: LabelSheet;
  pdf?: Uint8Array;
  zpl?: string;
  receipt?: LabelTransportReceipt;
  /** Transport outputs: true once delivered; false when another request holds the delivery. */
  delivered?: boolean;
}

interface Loaded {
  template: LabelTemplate;
  scheme: ScanScheme;
  rules: ScanRule[];
  identity: boolean;
}

async function load(name: string): Promise<Loaded> {
  const template = await getLabelTemplate(name);
  if (!template) throw new LabelRequestError(404, `label template "${name}" does not exist`);
  if (!template.enabled) throw new LabelRequestError(400, `label template "${name}" is disabled`);
  const scheme = await getScanScheme(template.scheme_version);
  if (!scheme) throw new LabelRequestError(404, `scan scheme ${template.scheme_version} does not exist`);
  const rules = await listScanRules(scheme.version);
  return { template, scheme, rules, identity: scheme.kind === SCAN_SCHEME_KINDS.IDENTITY };
}

/** Identity labels need credentialIssuer; item labels need admin or role management. */
export async function assertMayPrint(identity: boolean, auth: LTApiAuth): Promise<void> {
  const allowed = identity
    ? await mayIssueCredentials(auth)
    : (await mayAdminister(auth)) || (await mayManageRoles(auth));
  if (!allowed) {
    throw new LabelRequestError(403, identity
      ? 'printing badges requires credential-issuer access'
      : 'printing labels requires admin or role-management access');
  }
}

function layoutSheet(loaded: Loaded, contents: ReturnType<typeof buildLabelContents>['contents'], layout: LabelLayoutRequest = {}): LabelSheet {
  try {
    return buildLabelSheet({
      media: mediaForJob(layout.media, loaded.template.media),
      labels: contents,
      symbology: loaded.template.symbology,
      humanReadable: loaded.template.human_readable,
      startPosition: layout.startPosition,
      copies: layout.copies,
      onePerPage: layout.onePerPage,
      cutMarks: layout.cutMarks,
    });
  } catch (err) {
    if (err instanceof LabelLayoutError || err instanceof LabelMediaError) throw new LabelRequestError(400, err.message);
    throw err;
  }
}

async function compose(loaded: Loaded, targets: LabelTarget[], layout: LabelLayoutRequest | undefined, masked: boolean) {
  if (!loaded.identity) await markResolvedTargets(targets, loaded.scheme);
  const built = buildLabelContents(loaded.template, loaded.scheme, loaded.rules, targets, masked);
  const sheet = layoutSheet(loaded, built.contents, layout);
  const verified = verifyLabels(loaded.template, loaded.scheme, await listScanSchemes(), loaded.rules, targets, built.contents);
  const warnings = [...built.warnings, ...verified, ...sheet.warnings];
  return { sheet: { ...sheet, warnings }, warnings };
}

/**
 * Lay out a job without printing it. Sensitive templates are masked: the
 * preview shows where each code goes, never the code. Nothing is recorded.
 */
export async function previewLabels(
  req: { template: string; source: LabelSource; layout?: LabelLayoutRequest },
  auth: LTApiAuth,
): Promise<LabelPreview> {
  const loaded = await load(req.template);
  await assertMayPrint(loaded.identity, auth);
  const targets = await resolveLabelTargets(req.source, loaded.scheme, auth);
  const { sheet, warnings } = await compose(loaded, targets, req.layout, loaded.template.sensitive);
  return { template: loaded.template, sheet, warnings, labelCount: targets.length };
}

function transportFor(output: string, format: 'zpl' | 'pdf' | null) {
  const name = output.slice('transport:'.length);
  const transport = labelTransportRegistry.get(name);
  return { name, transport, format: format ?? (transport.formats.includes('zpl') ? 'zpl' : 'pdf') };
}

/**
 * Issue a job: check access and confirmation, record it, then compose and
 * deliver the codes as a sheet, a PDF, ZPL, or through a transport.
 */
export async function issueLabels(req: LabelIssueRequest, auth: LTApiAuth): Promise<LabelIssueResult> {
  const loaded = await load(req.template);
  await assertMayPrint(loaded.identity, auth);
  if (loaded.template.sensitive && req.confirm !== true) {
    throw new LabelRequestError(428, 'this template prints credentials or sensitive labels; confirm to print');
  }
  const transport = req.output.startsWith('transport:') ? transportFor(req.output, null) : null;
  if (!transport && !['sheet', 'pdf', 'zpl'].includes(req.output)) {
    throw new LabelRequestError(400, `unknown output "${req.output}"`);
  }
  const resolved = await resolveLabelTargets(req.source, loaded.scheme, auth);
  const only = req.only ? new Set(req.only) : null;
  const targets = only ? resolved.filter((t) => only.has(loaded.identity ? t.userId! : t.target)) : resolved;
  if (targets.length === 0) throw new LabelRequestError(400, 'none of the selected labels are in the source any more');
  const media = mediaForJob(req.layout?.media, loaded.template.media);
  const wantsZpl = req.output === 'zpl' || transport?.format === 'zpl';
  if (wantsZpl && media.family !== 'thermal') {
    throw new LabelRequestError(400, `ZPL prints on thermal media; "${media.id}" is sheet stock`);
  }

  const { job, replay } = await recordLabelJob({
    action: 'print',
    requested_by: auth.userId,
    idempotency_key: req.idempotencyKey ?? null,
    template_name: loaded.template.name,
    template_revision: loaded.template.revision,
    template_snapshot: loaded.template,
    scheme_version: loaded.scheme.version,
    scheme_kind: loaded.scheme.kind,
    sensitive: loaded.template.sensitive,
    source: req.source,
    subject_user_ids: loaded.identity ? targets.map((t) => t.userId!) : null,
    targets: loaded.identity ? null : targets.map((t) => t.target),
    label_count: targets.length * (req.layout?.copies ?? 1),
    media,
    output: req.output,
  });
  if (replay && (job.template_name !== loaded.template.name || job.output !== req.output)) {
    throw new LabelRequestError(409, 'this idempotency key was used for a different label request');
  }
  if (replay && transport && job.delivered_at) return { job, replay, warnings: [], delivered: true };

  // A replay prints the labels the first request recorded, nothing it did not.
  const recorded = new Set((loaded.identity ? job.subject_user_ids : job.targets) ?? []);
  const printing = replay ? targets.filter((t) => recorded.has(loaded.identity ? t.userId! : t.target)) : targets;
  const { sheet, warnings } = await compose(loaded, printing, req.layout, false);
  const result: LabelIssueResult = { job, replay, warnings };
  try {
    if (req.output === 'sheet') result.sheet = sheet;
    if (req.output === 'pdf') result.pdf = await renderSheetPdf(sheet);
    if (req.output === 'zpl') result.zpl = renderSheetZpl(sheet);
  } catch (err) {
    if (err instanceof ZplRenderError) throw new LabelRequestError(400, err.message);
    throw err;
  }
  if (transport) await deliver(job, transport, sheet, req.destination, result);
  return result;
}

/**
 * Send a recorded job through its transport under the delivery lease: the
 * claim is one statement, so concurrent retries of one job send once, and a
 * job whose sender crashed is sent by the first retry after the lease lapses.
 */
async function deliver(
  job: LabelJob,
  transport: ReturnType<typeof transportFor>,
  sheet: LabelSheet,
  destination: string | undefined,
  result: LabelIssueResult,
): Promise<void> {
  if (!(await claimLabelDelivery(job.id, config.LT_LABELS_DELIVERY_LEASE_SECONDS))) {
    result.delivered = false;
    return;
  }
  try {
    const payload = transport.format === 'zpl' ? renderSheetZpl(sheet) : await renderSheetPdf(sheet);
    result.receipt = await transport.transport.send({
      jobId: job.id, format: transport.format, payload, labelCount: job.label_count, destination,
    });
  } catch (err: any) {
    await releaseLabelDelivery(job.id);
    throw new LabelRequestError(502, `transport "${transport.name}" failed: ${err?.message ?? 'unknown error'}`);
  }
  await markLabelDelivered(job.id);
  result.delivered = true;
}
