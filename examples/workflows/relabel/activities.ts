import { issueLabels } from '../../../api/labels';
import { ensureSystemBot } from '../../../services/iam';
import { STORAGE_DROP_TRANSPORT } from '../../label-transports/storage-drop';

export interface PrintedLabel {
  jobId: string;
  replay: boolean;
  file: string | null;
}

/**
 * Print one label for `target` with `subtitle` as its {item.subtitle}, through
 * the storage-drop transport. The workflow id is the idempotency key, so a
 * replayed activity returns the first job instead of printing a second label.
 */
export async function printLabel(input: { template: string; target: string; subtitle: string; workflowId: string }): Promise<PrintedLabel> {
  const result = await issueLabels({
    template: input.template,
    source: { kind: 'list', text: `target,subtitle\n${input.target},${input.subtitle.replace(/[,\n]/g, ' ')}` },
    layout: { media: 'thermal-4x2' },
    output: `transport:${STORAGE_DROP_TRANSPORT}`,
    idempotencyKey: `relabel:${input.workflowId}`,
  }, { userId: await ensureSystemBot(), role: 'superadmin' });
  if (result.status !== 200) throw new Error(`label failed (${result.status}): ${result.error}`);
  return { jobId: result.data.job.id, replay: result.data.replay, file: result.data.receipt?.detail ?? null };
}
