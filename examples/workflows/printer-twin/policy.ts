/**
 * Printer Twin policy — pure facet helpers. Capability matching is metadata
 * containment: a demand row carries only the capabilities it REQUIRES (true),
 * and the broker's set-claim intersects on exactly those keys. The role wall
 * (fleet pond vs jobs pond) stays the hard cull; these facets are the soft fit.
 */

import { CAPABILITY_KEYS, TWIN_FACETS, TWIN_STATE } from './types';
import type { CapabilityKey, CapabilitySet, TwinRegistration } from './types';

/**
 * The capability keys a demand row requires — only keys explicitly `true`.
 * A capability the order does not need is simply absent, so any printer
 * (with or without it) satisfies the claim query.
 */
export function requiredCapabilities(
  metadata: Record<string, unknown>,
): Partial<CapabilitySet> {
  const required: Partial<CapabilitySet> = {};
  for (const key of CAPABILITY_KEYS) {
    if (metadata[key] === true) required[key] = true;
  }
  return required;
}

/**
 * Checkbox payloads arrive as booleans or 'true'/'false' strings depending on
 * the resolver surface — normalize once so the twin's facets are real booleans.
 */
export function normalizeRegistration(raw: Record<string, unknown>): TwinRegistration {
  const bool = (v: unknown): boolean => v === true || v === 'true';
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    serialNumber: str(raw.serialNumber),
    model: str(raw.model),
    manufactureDate: str(raw.manufactureDate),
    filament: str(raw.filament),
    certifications: str(raw.certifications),
    xl: bool(raw.xl),
    pdac: bool(raw.pdac),
    soft: bool(raw.soft),
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

/**
 * The facet set a registered twin stamps on every advert — identity plus the
 * full capability map (true AND false, so containment queries can require
 * either polarity).
 */
export function twinAdvertFacets(
  printerId: string,
  registration: TwinRegistration,
): Record<string, unknown> {
  const capabilities: Record<CapabilityKey, boolean> = {
    xl: registration.xl,
    pdac: registration.pdac,
    soft: registration.soft,
  };
  return {
    [TWIN_FACETS.PRINTER_ID]: printerId,
    [TWIN_FACETS.SERIAL_NUMBER]: registration.serialNumber,
    [TWIN_FACETS.MODEL]: registration.model,
    [TWIN_FACETS.FILAMENT]: registration.filament,
    ...capabilities,
  };
}

/** The claim query facets for one demand group — filament plus required capabilities. */
export function claimFacetsForGroup(
  headMetadata: Record<string, unknown>,
): Record<string, unknown> {
  return {
    [TWIN_FACETS.STATE]: TWIN_STATE.READY,
    [TWIN_FACETS.FILAMENT]: headMetadata[TWIN_FACETS.FILAMENT],
    ...requiredCapabilities(headMetadata),
  };
}
