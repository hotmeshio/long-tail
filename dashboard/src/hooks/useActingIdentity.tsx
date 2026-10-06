import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ScanExecuteResponse } from '../api/scan-codes';
import { setActingTokenProvider, setActingIdentityClear, setActingIdentitySpent } from '../api/client';

/** The primed badge holder — who scans act as until the grant lapses. */
export interface ActingIdentity {
  actingToken: string;
  /** The badged person's user id — the effective actor for claim comparisons. */
  actorId: string;
  displayName: string;
  /** ISO expiry copy; the keystore enforces the real one. */
  expiresAt: string | null;
  /** The grant binds to the first subject it acts on (identity scheme grant_scope 'subject'). */
  subjectScoped: boolean;
}

interface ActingIdentityContextValue {
  identity: ActingIdentity | null;
  /**
   * Adopt the grant from an IDENTITY_PRIMED response. Returns the token being
   * replaced (if any) so the caller can pass previousActingToken on the next
   * identity scan for best-effort revocation.
   */
  prime(response: ScanExecuteResponse): string | null;
  clear(): void;
  /**
   * Apply what a scan response says happened to the grant it carried: retire
   * it when no uses remain, or when a subject-scoped grant's subject is done.
   */
  settle(token: string, response: ScanExecuteResponse): void;
  /** Whole seconds until the grant lapses; 0 when none or already lapsed. */
  remainingSeconds(): number;
}

const ActingIdentityContext = createContext<ActingIdentityContextValue | null>(null);

export function useActingIdentity(): ActingIdentityContextValue {
  const ctx = useContext(ActingIdentityContext);
  if (!ctx) throw new Error('useActingIdentity must be used within ActingIdentityProvider');
  return ctx;
}

/**
 * Holds the acting-identity grant a badge scan mints. One state for the whole
 * shell: any page reads who is primed, scan execution attaches the token, and
 * a single timeout to the expiry instant clears the state when the grant
 * lapses. A re-prime (new badge) replaces the grant and resets the timeout.
 */
export function ActingIdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<ActingIdentity | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  // The grant clears itself at its expiry instant — one timeout, no polling.
  useEffect(() => {
    if (!identity?.expiresAt) return;
    const remaining = new Date(identity.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setIdentity(null);
      return;
    }
    const timer = setTimeout(() => setIdentity(null), remaining);
    return () => clearTimeout(timer);
  }, [identity]);

  const prime = useCallback((response: ScanExecuteResponse): string | null => {
    if (!response.actingToken || !response.actor) return null;
    const previous = identityRef.current?.actingToken ?? null;
    setIdentity({
      actingToken: response.actingToken,
      actorId: response.actor.id,
      displayName: response.actor.displayName,
      expiresAt: response.expiresAt ?? null,
      subjectScoped: response.grantScope === 'subject',
    });
    return previous;
  }, []);

  const clear = useCallback(() => setIdentity(null), []);

  // Retire the client copy when the server says the grant is used up,
  // matched by token so a newer grant primed in the meantime is never dropped.
  const spent = useCallback((token: string, remaining: number | null) => {
    const current = identityRef.current;
    if (remaining === 0 && current?.actingToken === token) setIdentity(null);
  }, []);

  const settle = useCallback((token: string, response: ScanExecuteResponse) => {
    const current = identityRef.current;
    if (!current || current.actingToken !== token || !response.acting) return;
    const { consumed, remaining, bound } = response.acting;
    if (consumed && remaining === 0) setIdentity(null);
    // A grant bound to one subject is spent for good once that subject is done.
    else if (bound && response.clearSubject) setIdentity(null);
  }, []);

  // Register the grant with the API client: every request carries the acting
  // token while primed, and an acting-identity 401 clears this state so the
  // client always matches the server's reality.
  useEffect(() => {
    setActingTokenProvider(() => identityRef.current?.actingToken ?? null);
    setActingIdentityClear(clear);
    setActingIdentitySpent(spent);
    return () => {
      setActingTokenProvider(null);
      setActingIdentityClear(null);
      setActingIdentitySpent(null);
    };
  }, [clear, spent]);

  const remainingSeconds = useCallback((): number => {
    const expiresAt = identityRef.current?.expiresAt;
    if (!expiresAt) return 0;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }, []);

  const value = useMemo(
    () => ({ identity, prime, clear, settle, remainingSeconds }),
    [identity, prime, clear, settle, remainingSeconds],
  );

  return <ActingIdentityContext.Provider value={value}>{children}</ActingIdentityContext.Provider>;
}
