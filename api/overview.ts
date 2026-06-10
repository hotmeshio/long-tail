import { getSystemOverview } from '../services/overview';
import type { LTApiResult } from '../types/sdk';

export async function overview(input: { period?: string }): Promise<LTApiResult> {
  try {
    const data = await getSystemOverview(input.period);
    return { status: 200, data };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
