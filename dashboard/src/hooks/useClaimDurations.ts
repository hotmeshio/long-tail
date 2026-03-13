import { useMemo } from 'react';
import { useSettings } from '../api/settings';
import { DEFAULT_CLAIM_DURATIONS, formatClaimDuration } from '../lib/constants';

export interface ClaimDurationOption {
  value: string;
  label: string;
}

/**
 * Returns claim duration presets from server settings (with fallback).
 * Options are formatted for use in selects and tab rows.
 */
export function useClaimDurations(): ClaimDurationOption[] {
  const { data: settings } = useSettings();

  return useMemo(() => {
    const minutes = settings?.escalation?.claimDurations ?? DEFAULT_CLAIM_DURATIONS;
    return minutes.map((m) => ({
      value: String(m),
      label: formatClaimDuration(m),
    }));
  }, [settings]);
}
