import { getStorageBackend } from '../../lib/storage';
import type { LTLabelTransport } from '../../types/labels';

/**
 * A label transport that drops each job into file storage at
 * labels/<jobId>.<format>. A print server or a shared folder watcher picks
 * them up from there; locally it gives Send a real destination without a
 * printer. A host registers its own transports the same way, by name:
 *
 *   start({ labels: { transports: { 'storage-drop': storageDropTransport } } })
 */
export const STORAGE_DROP_TRANSPORT = 'storage-drop';

export const storageDropTransport: LTLabelTransport = {
  formats: ['pdf', 'zpl'],
  async send(job) {
    const key = `labels/${job.jobId}.${job.format}`;
    const data = typeof job.payload === 'string' ? Buffer.from(job.payload, 'utf8') : Buffer.from(job.payload);
    const { ref } = await getStorageBackend().write(key, data);
    return { accepted: true, detail: ref };
  },
};
