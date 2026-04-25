import { maintenanceRegistry } from '../services/maintenance';
import type { LTMaintenanceConfig } from '../types/maintenance';
import type { LTApiResult } from '../types/sdk';

export function getMaintenanceConfig(): LTApiResult {
  return {
    status: 200,
    data: { config: maintenanceRegistry.config, active: maintenanceRegistry.hasConfig },
  };
}

export async function updateMaintenanceConfig(
  input: { schedule: string; rules: LTMaintenanceConfig['rules'] },
): Promise<LTApiResult> {
  try {
    if (!input.schedule || !Array.isArray(input.rules)) {
      return { status: 400, error: 'schedule (string) and rules (array) are required' };
    }
    await maintenanceRegistry.disconnect();
    maintenanceRegistry.register({ schedule: input.schedule, rules: input.rules });
    await maintenanceRegistry.connect();
    return {
      status: 200,
      data: { config: maintenanceRegistry.config, restarted: true },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
