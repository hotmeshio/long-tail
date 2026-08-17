import type { CascadeResolverV1 } from './forms';

export interface CatalogPickResult {
  material: string;
  country: string;
  region: string;
  checksTotal: number;
  checksConfirmed: number;
  notes?: string;
  processedAt: string;
}

export async function processCatalogPick(input: CascadeResolverV1): Promise<CatalogPickResult> {
  const entries = Object.entries(input.checks ?? {});
  return {
    material: input.material,
    country: input.country,
    region: input.region,
    checksTotal: entries.length,
    checksConfirmed: entries.filter(([, v]) => v === true).length,
    notes: input.notes,
    processedAt: new Date().toISOString(),
  };
}
