import { hmshTimestampToISO } from '../hotmesh-utils';

/**
 * Extract the activity name from a HotMesh job_id field.
 * Format: -workflowId-$activityName-N
 */
export function extractActivityName(jobId: string): string {
  const match = jobId.match(/\$([^-]+)-\d+$/);
  return match ? match[1] : jobId;
}

/**
 * Extract a child workflow ID from a job_id.
 * Format: -parentId-$childName-N -> strip to get the child workflow identifier
 */
export function extractChildWorkflowId(jobId: string): string {
  const match = jobId.match(/^-(.+)-\d+$/);
  return match ? match[1] : jobId;
}

/**
 * Sort + filter attribute keys matching a prefix (e.g., '-wait-')
 * and parse each JSON value.
 */
export function getOperationKeys(
  attrs: Record<string, string>,
  prefix: string,
): Array<{ key: string; index: number; val: Record<string, unknown> }> {
  return Object.keys(attrs)
    .filter((k) => k.startsWith(prefix))
    .sort((a, b) => {
      const numA = parseInt(a.replace(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|-`, 'g'), ''));
      const numB = parseInt(b.replace(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|-`, 'g'), ''));
      return numA - numB;
    })
    .map((key) => {
      const raw = attrs[key].startsWith('/s') ? attrs[key].slice(2) : attrs[key];
      try {
        return { key, index: parseInt(key.replace(/[^0-9]/g, '')), val: JSON.parse(raw) };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ key: string; index: number; val: Record<string, unknown> }>;
}

/**
 * Parse a HotMesh-encoded value string.
 * Values may be prefixed with `/s` (string type marker).
 */
export function parseHmshValue(raw: string): unknown {
  const json = raw.startsWith('/s') ? raw.slice(2) : raw;
  return JSON.parse(json);
}

/**
 * Compute duration between two HotMesh timestamps.
 */
export function computeDuration(ac?: string, au?: string): number | null {
  if (!ac || !au) return null;
  const s = new Date(hmshTimestampToISO(ac)).getTime();
  const e = new Date(hmshTimestampToISO(au)).getTime();
  return e >= s ? e - s : null;
}
