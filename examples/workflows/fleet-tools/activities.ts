import type { FleetToolsInput } from './forms';

export interface FleetToolSummary {
  serialNumber: string;
  action: string;
  details: Record<string, unknown>;
  appliedAt: string;
}

/**
 * Apply one fleet tool to one machine. The reference implementation records
 * the request; a deployment swaps in the label printer, the twin update, or
 * the service escalation through the public api/ surface.
 */
export async function applyFleetTool(input: FleetToolsInput): Promise<FleetToolSummary> {
  return {
    serialNumber: input.printer.serialNumber,
    action: input.tool.action,
    details: input.tool.details ?? {},
    appliedAt: new Date().toISOString(),
  };
}
