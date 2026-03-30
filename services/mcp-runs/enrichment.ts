import { getEngine } from '../controlplane';
import type { ActivityDetail } from './types';

/**
 * Fetch enriched activity inputs from HotMesh's stream history.
 * Returns a lookup map keyed by `name:dimension` for merging into events.
 * Best-effort — returns empty map on failure.
 */
export async function fetchActivityInputs(
  jobId: string,
  appId: string,
): Promise<Map<string, Record<string, any>>> {
  const map = new Map<string, Record<string, any>>();
  try {
    const engine = await getEngine(appId);
    const exported = await engine.export(jobId, { enrich_inputs: true });
    for (const activity of exported.activities ?? []) {
      map.set(`${activity.name}:${activity.dimension}`, activity.input ?? {});
    }
  } catch {
    // enrichment is best-effort; continue without inputs
  }
  return map;
}

/**
 * Fetch the structured ActivityDetail array from HotMesh export.
 * Returns undefined if enrichment fails or produces no results.
 */
export async function fetchActivityDetails(
  jobId: string,
  appId: string,
): Promise<ActivityDetail[] | undefined> {
  try {
    const engine = await getEngine(appId);
    const exported = await engine.export(jobId, { enrich_inputs: true });
    const activities = exported.activities as ActivityDetail[] | undefined;
    return activities?.length ? activities : undefined;
  } catch {
    return undefined;
  }
}
