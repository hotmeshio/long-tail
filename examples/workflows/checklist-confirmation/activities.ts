import type { ChecklistResolverV1 } from './forms';

export interface ChecklistSummary {
  total: number;
  confirmed: number;
  unconfirmed: number;
  allConfirmed: boolean;
  unconfirmedIds: string[];
  processedAt: string;
}

export async function summarizeChecklist(input: ChecklistResolverV1): Promise<ChecklistSummary> {
  const entries = Object.entries(input.items ?? {});
  const confirmed = entries.filter(([, v]) => v === true);
  const unconfirmed = entries.filter(([, v]) => v !== true);
  return {
    total: entries.length,
    confirmed: confirmed.length,
    unconfirmed: unconfirmed.length,
    allConfirmed: unconfirmed.length === 0 && entries.length > 0,
    unconfirmedIds: unconfirmed.map(([k]) => k),
    processedAt: new Date().toISOString(),
  };
}
