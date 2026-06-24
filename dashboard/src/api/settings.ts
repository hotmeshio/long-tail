import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface AppSettings {
  telemetry: {
    traceUrl: string | null;
  };
  escalation?: {
    claimDurations?: number[];
  };
  ai?: {
    enabled: boolean;
  };
  features?: {
    /** DB Maintenance admin page is shown. Default: true (omitted treated as true). */
    dbMaintenance?: boolean;
  };
  environment?: {
    longTailVersion: string;
    hotmeshVersion: string;
    nodeEnv: string;
    nodeVersion: string;
    eventTransport: string;
  };
}

const AI_OVERRIDE_KEY = 'lt_ai_override';

function fetchSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>('/settings');
}

function readAIOverride(): boolean | null {
  try {
    const v = localStorage.getItem(AI_OVERRIDE_KEY);
    if (v === 'off') return false;
  } catch { /* localStorage unavailable */ }
  return null;
}

export function useSettings() {
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: Infinity,
  });

  // Apply localStorage AI override (easter egg)
  const override = readAIOverride();
  if (query.data && override === false && query.data.ai?.enabled) {
    return {
      ...query,
      data: { ...query.data, ai: { enabled: false } },
    };
  }

  return query;
}

/**
 * Easter egg: toggle AI features off via localStorage.
 * Reads directly from localStorage on every call — no stale closures.
 */
export function useAIOverride() {
  const [active, setActive] = useState(() => readAIOverride() === false);

  const toggle = useCallback(() => {
    // Read current state directly from localStorage (not React state)
    const isCurrentlyOff = readAIOverride() === false;
    try {
      if (isCurrentlyOff) {
        localStorage.removeItem(AI_OVERRIDE_KEY);
      } else {
        localStorage.setItem(AI_OVERRIDE_KEY, 'off');
      }
    } catch { /* quota exceeded */ }
    setActive(!isCurrentlyOff);
    window.location.reload();
  }, []);

  return { aiOverrideActive: active, toggleAIOverride: toggle };
}
