import { maintenanceRegistry } from '../services/maintenance';
import type { LTMaintenanceConfig } from '../types/maintenance';
import type { LTApiResult } from '../types/sdk';

/**
 * Return the current maintenance cron configuration and active state.
 *
 * @returns `{ status: 200, data: { config, active } }`
 */
export function getMaintenanceConfig(): LTApiResult {
  return {
    status: 200,
    data: { config: maintenanceRegistry.config, active: maintenanceRegistry.hasConfig },
  };
}

/**
 * Replace the maintenance configuration and restart the cron.
 *
 * Disconnects the current maintenance schedule, registers the new
 * config, and reconnects. The cron begins executing immediately.
 *
 * @param input.schedule — cron expression (e.g. `"0 3 * * *"`)
 * @param input.rules — maintenance rule definitions
 * @returns `{ status: 200, data: { config, restarted: true } }`
 */
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
