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
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useActingIdentity } from './useActingIdentity';
import { useKioskMode } from './useKioskMode';
import { useWedgeCapture, type ScanKeyDiag } from './useWedgeCapture';
import {
  executeScanCode,
  SCAN_OUTCOMES,
  SCAN_VERBS,
  useScanSchemes,
  type ScanExecuteResponse,
} from '../api/scan-codes';
import {
  buildTailShapes,
  loadWedgeConfig,
  saveWedgeConfig,
  type WedgeConfig,
} from '../lib/scan-sources/keyboard-wedge';
import {
  isReplayable,
  nextSubject,
  replayable,
  subjectRef,
  STATION_OUTCOMES,
  type PendingScan,
  type StationSubject,
} from '../lib/scan-subject';
import { SCAN_SOURCE_IDS, type ScanSourceId } from '../lib/scan-sources/types';
import { metadataFacetsUrl } from '../lib/facet-url';
import { getScanOverride } from '../lib/view-as';
import { useSettings } from '../api/settings';

export type { ScanKeyDiag } from './useWedgeCapture';

/**
 * Effective scan-input state: the deployment's `features.scanCodes` flag
 * (opt-in, default false) unless a local easter-egg override is set. Gates
 * every scan surface — the header affordance, the panel, and the global
 * keyboard-wedge capture.
 */
export function useScanEnabled(): boolean {
  const { data: settings } = useSettings();
  const override = getScanOverride();
  return override !== null ? override : !!settings?.features?.scanCodes;
}

export interface ScanResult {
  code: string;
  source: string;
  at: number;
  response: ScanExecuteResponse | null;
  error: string | null;
  /** True when the outcome answered with navigation (detail page, list, confirm). */
  navigated: boolean;
}

interface ScanInputContextValue {
  /** Submit a code from any source (manual entry, tests). */
  submitCode(code: string, source?: string): Promise<void>;
  /**
   * Client-side first look at every raw code, ahead of the POST. The newest
   * interceptor looks first; return true to consume the code (the station
   * claims choice codes this way, an open form fills a scan field), false to
   * pass it on. Returns the function that unregisters it.
   */
  pushCodeInterceptor(fn: (raw: string) => boolean): () => void;
  lastResult: ScanResult | null;
  /** The item the station is holding for the next scan. */
  subject: StationSubject | null;
  /** Let go of the held item. */
  dropSubject(): void;
  /** Fold a response from outside the pipeline (an executed choice) into the held subject. */
  adoptResponse(response: ScanExecuteResponse): void;
  /** A scan waiting on a badge; it replays once the badge primes. */
  pendingScan: PendingScan | null;
  /** Let go of the waiting scan. */
  dropPendingScan(): void;
  busy: boolean;
  wedgeConfig: WedgeConfig;
  updateWedgeConfig(patch: Partial<WedgeConfig>): void;
  /** Live keydown trace for the panel's diagnostics view. */
  diagnostics: ScanKeyDiag[];
  diagnosticsOn: boolean;
  setDiagnosticsOn(on: boolean): void;
}

const ScanInputContext = createContext<ScanInputContextValue | null>(null);

export function useScanInput(): ScanInputContextValue {
  const ctx = useContext(ScanInputContext);
  if (!ctx) throw new Error('useScanInput must be used within ScanInputProvider');
  return ctx;
}

/** The scan pipeline when the page sits inside one, else null (embedded and test renders). */
export function useOptionalScanInput(): ScanInputContextValue | null {
  return useContext(ScanInputContext);
}

/** Route state key the escalation detail page reads for the confirm modal. */
export const SCAN_PENDING_ACTION_STATE = 'scanPendingAction';

/** Route state key the scan station reads for a CHOICES response. */
export const SCAN_CHOICES_STATE = 'scanChoices';

/** The station route a CHOICES outcome lands on. */
export const SCAN_STATION_ROUTE = '/scan/station';

/**
 * The scan dispatch pipeline: captures codes from input sources (the HID
 * keyboard-wedge listener here; manual entry via the panel) and executes
 * them server-side. The response's outcome drives navigation:
 *
 * - executed (show verbs)   → escalation detail page
 * - executed (act verbs)    → detail page of the acted-on escalation
 * - matched_list            → escalations list deep-linked to the facet query
 * - confirm_required        → detail page with the pending action in route
 *                             state; the page raises the confirm modal
 * - no_match_fallback       → the rule's route, or stays put (panel shows
 *                             the fallback markdown)
 * - choices                 → station route with the response in route state;
 *                             the station renders reality + choices
 * - identity_primed         → primes the acting-identity context, stays put
 * - everything else         → reported in the scan panel / result state
 */
export function ScanInputProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = useScanEnabled();
  const navigate = useNavigate();
  const location = useLocation();
  const { identity, prime, clear, settle } = useActingIdentity();
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [subject, setSubject] = useState<StationSubject | null>(null);
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const { data: schemeData } = useScanSchemes({ enabled: !!user && enabled, staleTime: 60_000 });
  // The role this device is locked to decides the badge policy a badge scan mints under.
  const stationRoleRef = useRef<string | null>(null);
  stationRoleRef.current = useKioskMode().role;
  const tailShapes = useMemo(() => buildTailShapes(schemeData?.schemes ?? []), [schemeData]);
  const [busy, setBusy] = useState(false);
  const [wedgeConfig, setWedgeConfig] = useState<WedgeConfig>(() => loadWedgeConfig());
  const [diagnostics, setDiagnostics] = useState<ScanKeyDiag[]>([]);
  const [diagnosticsOn, setDiagnosticsOn] = useState(false);

  /** Navigate per the outcome; true when navigation was the answer. */
  const navigateForResponse = useCallback((response: ScanExecuteResponse): boolean => {
    const { outcome } = response;

    if (outcome === SCAN_OUTCOMES.CONFIRM_REQUIRED && response.pendingAction) {
      navigate(`/escalations/detail/${response.pendingAction.escalationId}`, {
        state: { [SCAN_PENDING_ACTION_STATE]: response.pendingAction },
      });
      return true;
    }

    // The bench motion (hold, refuse, badge stop, placed) answers on the station.
    const benchAct = outcome === SCAN_OUTCOMES.EXECUTED && !!subjectRefOnSend.current;
    if (STATION_OUTCOMES.includes(outcome) || isReplayable(response) || benchAct) {
      if (locationRef.current !== SCAN_STATION_ROUTE) navigate(SCAN_STATION_ROUTE);
      return true;
    }

    if (outcome === SCAN_OUTCOMES.EXECUTED && response.escalation) {
      const showVerbs: string[] = [
        SCAN_VERBS.SHOW_DETAIL,
        SCAN_VERBS.CLAIM_SHOW_DETAIL,
        SCAN_VERBS.CLAIM,
        SCAN_VERBS.ESCALATE,
      ];
      if (response.verb && showVerbs.includes(response.verb)) {
        navigate(`/escalations/detail/${response.escalation.id}`);
        return true;
      }
      return false;
    }

    if (outcome === SCAN_OUTCOMES.MATCHED_LIST && response.listQuery) {
      const { targetFacet, target, roles } = response.listQuery as {
        targetFacet: string; target: string; roles?: string[];
      };
      navigate(metadataFacetsUrl({ [targetFacet]: target }, roles?.[0] ?? null));
      return true;
    }

    if (outcome === SCAN_OUTCOMES.CHOICES && response.choices) {
      navigate(SCAN_STATION_ROUTE, { state: { [SCAN_CHOICES_STATE]: response } });
      return true;
    }

    if (outcome === SCAN_OUTCOMES.NO_MATCH_FALLBACK && response.fallback?.route) {
      navigate(response.fallback.route);
      return true;
    }
    return false;
  }, [navigate]);

  // Live refs so submitCode stays stable while the grant changes underneath.
  const actingTokenRef = useRef<string | null>(null);
  actingTokenRef.current = identity?.actingToken ?? null;
  // The grant a re-prime replaced — sent on the next scan so an identity
  // scan's mint can best-effort revoke it.
  const previousTokenRef = useRef<string | null>(null);
  // Client-side first looks at raw codes, newest first (choice codes, form scan fields).
  const interceptorsRef = useRef<((raw: string) => boolean)[]>([]);

  const pushCodeInterceptor = useCallback((fn: (raw: string) => boolean) => {
    interceptorsRef.current = [fn, ...interceptorsRef.current];
    return () => { interceptorsRef.current = interceptorsRef.current.filter((f) => f !== fn); };
  }, []);

  // Live refs: the subject a scan carries, the scan waiting on a badge, and
  // where the shell is, read inside the stable callbacks below.
  const subjectRefState = useRef<StationSubject | null>(null);
  subjectRefState.current = subject;
  const subjectRefOnSend = useRef<ReturnType<typeof subjectRef>>(undefined);
  const pendingRef = useRef<PendingScan | null>(null);
  pendingRef.current = pendingScan;
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  // The held subject lapses on its own; one timeout to its expiry, no polling.
  useEffect(() => {
    if (!subject) return;
    const remaining = Date.parse(subject.expiresAt) - Date.now();
    if (remaining <= 0) { setSubject(null); return; }
    const timer = setTimeout(() => setSubject(null), remaining);
    return () => clearTimeout(timer);
  }, [subject]);

  /** POST one code and fold the answer into station state. */
  const execute = useCallback(async (code: string, source: string, token: string | null) => {
    setBusy(true);
    const at = Date.now();
    try {
      subjectRefOnSend.current = subjectRef(subjectRefState.current);
      const response = await executeScanCode(code, {
        actingToken: token ?? undefined,
        previousActingToken: previousTokenRef.current ?? undefined,
        subject: subjectRefOnSend.current,
        stationRole: stationRoleRef.current ?? undefined,
      });
      if (token) settle(token, response);
      setSubject((current) => nextSubject(current, response));

      if (response.outcome === SCAN_OUTCOMES.IDENTITY_PRIMED) {
        previousTokenRef.current = prime(response);
        // A scan waiting on this badge runs now, as this person.
        const waiting = replayable(pendingRef.current);
        setPendingScan(null);
        if (waiting && response.actingToken) {
          setLastResult({ code, source, at, response, error: null, navigated: false });
          await execute(waiting.code, source, response.actingToken);
          return;
        }
      } else if (isReplayable(response)) {
        // The act needs a badge: hold the scan and replay it once one primes.
        setPendingScan({ code, at });
      } else {
        setPendingScan(null);
      }
      // A live grant always satisfies the identity check, so not_primed on a
      // scan that carried one means the server found it dead. Drop the stale
      // copy so the next scan runs unprimed instead of repeating the badge
      // screen until the TTL lapses.
      if (response.outcome === SCAN_OUTCOMES.NOT_PRIMED && token) {
        clear();
      }
      const navigated = navigateForResponse(response);
      setLastResult({ code, source, at, response, error: null, navigated });
    } catch (err: any) {
      setLastResult({ code, source, at, response: null, error: err.message, navigated: false });
    } finally {
      setBusy(false);
    }
  }, [navigateForResponse, prime, clear, settle]);

  const submitCode = useCallback(async (code: string, source: ScanSourceId = SCAN_SOURCE_IDS.MANUAL) => {
    // Interceptors run before the POST; a consumed code never executes.
    for (const intercept of interceptorsRef.current) {
      if (intercept(code)) return;
    }
    await execute(code, source, actingTokenRef.current);
  }, [execute]);

  const dropSubject = useCallback(() => setSubject(null), []);
  const adoptResponse = useCallback((response: ScanExecuteResponse) => {
    setSubject((current) => nextSubject(current, response));
  }, []);
  const dropPendingScan = useCallback(() => setPendingScan(null), []);

  // Live refs so the capture listener stays installed across renders.
  const submitRef = useRef(submitCode);
  submitRef.current = submitCode;

  // The HID keyboard-wedge source — captured codes flow into submitCode like
  // any other source; observed keydowns feed the panel's diagnostics view.
  useWedgeCapture({
    active: !!user && enabled,
    wedgeConfig,
    tailShapes,
    diagnosticsOn,
    onScan: (code) => void submitRef.current(code, SCAN_SOURCE_IDS.KEYBOARD_WEDGE),
    onDiag: (entry) => setDiagnostics((prev) => [...prev.slice(-29), entry]),
  });

  const updateWedgeConfig = useCallback((patch: Partial<WedgeConfig>) => {
    setWedgeConfig(saveWedgeConfig(patch));
  }, []);

  const value = useMemo(
    () => ({
      submitCode, pushCodeInterceptor, lastResult, subject, dropSubject, adoptResponse, pendingScan, dropPendingScan,
      busy, wedgeConfig, updateWedgeConfig, diagnostics, diagnosticsOn, setDiagnosticsOn,
    }),
    [submitCode, pushCodeInterceptor, lastResult, subject, dropSubject, adoptResponse, pendingScan, dropPendingScan,
      busy, wedgeConfig, updateWedgeConfig, diagnostics, diagnosticsOn],
  );

  return <ScanInputContext.Provider value={value}>{children}</ScanInputContext.Provider>;
}
