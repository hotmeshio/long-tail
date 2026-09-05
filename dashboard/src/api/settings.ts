import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LT_BASE } from '../lib/base-path';

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
  auth?: {
    sso: boolean;
    ssoLogoutUrl?: string | null;
    /** SSO session keepalive interval (seconds); null/absent = no keepalive. */
    ssoKeepaliveSeconds?: number | null;
    /** Pause the keepalive after this much inactivity; null/absent = no idle gate. */
    ssoKeepaliveIdleTimeoutSeconds?: number | null;
  };
  search?: {
    /** Global search bar in the header. Default: off. */
    enabled: boolean;
    /** Metadata facet names the picklist offers, beyond the always-present escalationId/workflowId. */
    facets: string[];
  };
  features?: {
    /** DB Maintenance admin page is shown. Default: true (omitted treated as true). */
    dbMaintenance?: boolean;
    /** Pace Board readable by every login (aggregate counts and trends). Default: true. */
    publicPaceBoard?: boolean;
    /**
     * Graph workflow section visibility.
     * true  → always shown.
     * false → always hidden (easter egg toggle suppressed).
     * absent → user-controlled via easter egg (default off).
     */
    graphWorkflows?: boolean;
    /**
     * Scan-code input surfaces (header scan affordance, panel, keyboard-wedge
     * capture) for every persona. Opt-in: default false. A local easter-egg
     * override tests either state without a deployment change.
     */
    scanCodes?: boolean;
  };
  branding?: {
    appName?: string;
    /** Deployment-registered themes (metadata only; CSS arrives via /api/settings/custom.css). */
    themes?: Array<{ id: string; label: string; swatch: string; dark?: boolean }>;
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

let settingsPromise: Promise<AppSettings> | null = null;

/**
 * Deployment settings are user-agnostic and static per page load, so /api/settings
 * is fetched once and the promise shared across every consumer — the transport
 * bootstrap, the login screen, and useSettings. A failed fetch clears the memo so
 * the next caller retries.
 */
export function loadSettings(): Promise<AppSettings> {
  if (!settingsPromise) {
    settingsPromise = fetch(`${LT_BASE}/api/settings`)
      .then((res) => {
        if (!res.ok) throw new Error(`settings ${res.status}`);
        return res.json() as Promise<AppSettings>;
      })
      .catch((err) => { settingsPromise = null; throw err; });
  }
  return settingsPromise;
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
    queryFn: loadSettings,
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
