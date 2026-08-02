import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useActingIdentity } from './useActingIdentity';
import { useWedgeCapture, type ScanKeyDiag } from './useWedgeCapture';
import {
  executeScanCode,
  SCAN_OUTCOMES,
  SCAN_VERBS,
  type ScanExecuteResponse,
} from '../api/scan-codes';
import {
  loadWedgeConfig,
  saveWedgeConfig,
  type WedgeConfig,
} from '../lib/scan-sources/keyboard-wedge';
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
   * Client-side first look at every raw code, ahead of the POST. Return true
   * to consume it (the station screen claims short choice codes this way);
   * false lets the code execute normally. Pass null to unregister.
   */
  setCodeInterceptor(fn: ((raw: string) => boolean) | null): void;
  lastResult: ScanResult | null;
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
  const { identity, prime } = useActingIdentity();
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
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
  // The station's client-side first look at raw codes (choice-code double scan).
  const interceptorRef = useRef<((raw: string) => boolean) | null>(null);

  const setCodeInterceptor = useCallback((fn: ((raw: string) => boolean) | null) => {
    interceptorRef.current = fn;
  }, []);

  const submitCode = useCallback(async (code: string, source: ScanSourceId = SCAN_SOURCE_IDS.MANUAL) => {
    // The interceptor runs before the POST — a consumed code never executes.
    if (interceptorRef.current?.(code)) return;
    setBusy(true);
    const at = Date.now();
    try {
      const response = await executeScanCode(code, {
        actingToken: actingTokenRef.current ?? undefined,
        previousActingToken: previousTokenRef.current ?? undefined,
      });
      if (response.outcome === SCAN_OUTCOMES.IDENTITY_PRIMED) {
        previousTokenRef.current = prime(response);
      }
      const navigated = navigateForResponse(response);
      setLastResult({ code, source, at, response, error: null, navigated });
    } catch (err: any) {
      setLastResult({ code, source, at, response: null, error: err.message, navigated: false });
    } finally {
      setBusy(false);
    }
  }, [navigateForResponse, prime]);

  // Live refs so the capture listener stays installed across renders.
  const submitRef = useRef(submitCode);
  submitRef.current = submitCode;

  // The HID keyboard-wedge source — captured codes flow into submitCode like
  // any other source; observed keydowns feed the panel's diagnostics view.
  useWedgeCapture({
    active: !!user && enabled,
    wedgeConfig,
    diagnosticsOn,
    onScan: (code) => void submitRef.current(code, SCAN_SOURCE_IDS.KEYBOARD_WEDGE),
    onDiag: (entry) => setDiagnostics((prev) => [...prev.slice(-29), entry]),
  });

  const updateWedgeConfig = useCallback((patch: Partial<WedgeConfig>) => {
    setWedgeConfig(saveWedgeConfig(patch));
  }, []);

  const value = useMemo(
    () => ({ submitCode, setCodeInterceptor, lastResult, busy, wedgeConfig, updateWedgeConfig, diagnostics, diagnosticsOn, setDiagnosticsOn }),
    [submitCode, setCodeInterceptor, lastResult, busy, wedgeConfig, updateWedgeConfig, diagnostics, diagnosticsOn],
  );

  return <ScanInputContext.Provider value={value}>{children}</ScanInputContext.Provider>;
}
