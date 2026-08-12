import { useEffect, useRef } from 'react';
import { useSettings } from '../api/settings';
import { decodeJwtPayload } from '../lib/jwt';
import { LT_BASE } from '../lib/base-path';

/**
 * SSO session keepalive — keeps a short-lived sliding HOST session warm while
 * someone is actually working the dashboard.
 *
 * The embedded SPA never navigates the host shell, so nothing else re-touches
 * the host session; without this, an operator mid-task is logged out when the
 * host access token lapses. While the tab is visible (and, when an idle
 * timeout is configured, the user has recently interacted), the hook re-runs
 * the credentialed exchange (`POST /api/auth/sso`, host cookies ride
 * automatically) every `ssoKeepaliveSeconds` — the same effect as host-app
 * navigation. Each beat re-runs the host's `resolve`, so a revoked session is
 * cut off at the next beat.
 *
 * Outcome handling:
 * - 2xx with a token → `auth:refreshed` (the auth provider stores it and
 *   pushes its own 24h refresh timer out).
 * - Explicit 401/403 → `auth:unauthorized` (logout — the host said no).
 * - Anything else (network error, 5xx, a token-less 200 such as a host
 *   middleware redirecting to an HTML login page) → skip and retry next beat;
 *   a blip must never log a working operator out.
 *
 * Idle/hidden tabs simply skip beats, so the host session lapses on its own
 * schedule. The 24h LT JWT is untouched by design — session lifetime is the
 * host's boundary, enforced by the host middleware fronting the mount.
 */
export function useSsoKeepalive(token: string | null): void {
  const { data: settings } = useSettings();
  const keepaliveSeconds = settings?.auth?.ssoKeepaliveSeconds ?? 0;
  const idleTimeoutSeconds = settings?.auth?.ssoKeepaliveIdleTimeoutSeconds ?? 0;

  const lastActivityRef = useRef(Date.now());
  const lastSuccessRef = useRef(Date.now());
  const inFlightRef = useRef(false);

  const ssoToken = !!token && decodeJwtPayload(token)?.sso === true;
  const active = ssoToken && keepaliveSeconds > 0;

  useEffect(() => {
    if (!active) return;

    const touch = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch, { passive: true });
    window.addEventListener('wheel', touch, { passive: true });

    const beat = async () => {
      if (inFlightRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (idleTimeoutSeconds > 0 && Date.now() - lastActivityRef.current > idleTimeoutSeconds * 1000) return;

      inFlightRef.current = true;
      try {
        const res = await fetch(`${LT_BASE}/api/auth/sso`, { method: 'POST' });
        if (res.status === 401 || res.status === 403) {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          return;
        }
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.token) {
          lastSuccessRef.current = Date.now();
          window.dispatchEvent(new CustomEvent('auth:refreshed', { detail: { token: data.token } }));
        }
      } catch {
        // Network blip — next beat retries.
      } finally {
        inFlightRef.current = false;
      }
    };

    const interval = setInterval(beat, keepaliveSeconds * 1000);
    // Returning to a backgrounded tab: one immediate gated beat when the last
    // refresh is stale, so a still-live host session slides before it lapses.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastSuccessRef.current > keepaliveSeconds * 1000) void beat();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.removeEventListener('wheel', touch);
    };
  }, [active, keepaliveSeconds, idleTimeoutSeconds]);
}
