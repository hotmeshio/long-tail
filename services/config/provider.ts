import { getPool } from '../../lib/db';
import type { LTProviderData } from '../../types';
import { GET_PROVIDER_DATA } from './sql';

export async function getProviderData(
  consumes: string[],
  originId: string,
): Promise<LTProviderData> {
  if (!consumes.length || !originId) return {};

  const pool = getPool();

  const { rows } = await pool.query(GET_PROVIDER_DATA, [originId, consumes]);

  const result: LTProviderData = {};
  for (const row of rows) {
    // Keep first (most recent) per workflow type
    if (result[row.workflow_type]) continue;
    let parsed: Record<string, any> = {};
    try {
      parsed = row.data ? JSON.parse(row.data) : {};
    } catch {
      parsed = {};
    }
    result[row.workflow_type] = {
      data: parsed,
      completedAt: row.completed_at?.toISOString() || '',
      workflowType: row.workflow_type,
    };
  }

  return result;
}
