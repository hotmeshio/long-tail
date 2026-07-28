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
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import {
  executeScanCode,
  SCAN_OUTCOMES,
  SCAN_VERBS,
  type ScanExecuteResponse,
} from '../api/scan-codes';
import {
  createWedgeMachine,
  loadWedgeConfig,
  saveWedgeConfig,
  type WedgeConfig,
} from '../lib/scan-sources/keyboard-wedge';
import { SCAN_SOURCE_IDS, type ScanSourceId } from '../lib/scan-sources/types';
import { metadataFacetsUrl } from '../lib/facet-url';
import { getScanOverride } from '../lib/view-as';
import { useSettings } from '../api/settings';

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
}

interface ScanInputContextValue {
  /** Submit a code from any source (manual entry, tests). */
  submitCode(code: string, source?: string): Promise<void>;
  lastResult: ScanResult | null;
  busy: boolean;
  wedgeConfig: WedgeConfig;
  updateWedgeConfig(patch: Partial<WedgeConfig>): void;
}

const ScanInputContext = createContext<ScanInputContextValue | null>(null);

export function useScanInput(): ScanInputContextValue {
  const ctx = useContext(ScanInputContext);
  if (!ctx) throw new Error('useScanInput must be used within ScanInputProvider');
  return ctx;
}

/** Route state key the escalation detail page reads for the confirm modal. */
export const SCAN_PENDING_ACTION_STATE = 'scanPendingAction';

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
 * - everything else         → reported in the scan panel / result state
 */
export function ScanInputProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = useScanEnabled();
  const navigate = useNavigate();
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [wedgeConfig, setWedgeConfig] = useState<WedgeConfig>(() => loadWedgeConfig());

  const navigateForResponse = useCallback((response: ScanExecuteResponse) => {
    const { outcome } = response;

    if (outcome === SCAN_OUTCOMES.CONFIRM_REQUIRED && response.pendingAction) {
      navigate(`/escalations/detail/${response.pendingAction.escalationId}`, {
        state: { [SCAN_PENDING_ACTION_STATE]: response.pendingAction },
      });
      return;
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
      }
      return;
    }

    if (outcome === SCAN_OUTCOMES.MATCHED_LIST && response.listQuery) {
      const { targetFacet, target, roles } = response.listQuery as {
        targetFacet: string; target: string; roles?: string[];
      };
      navigate(metadataFacetsUrl({ [targetFacet]: target }, roles?.[0] ?? null));
      return;
    }

    if (outcome === SCAN_OUTCOMES.NO_MATCH_FALLBACK && response.fallback?.route) {
      navigate(response.fallback.route);
    }
  }, [navigate]);

  const submitCode = useCallback(async (code: string, source: ScanSourceId = SCAN_SOURCE_IDS.MANUAL) => {
    setBusy(true);
    const at = Date.now();
    try {
      const response = await executeScanCode(code);
      setLastResult({ code, source, at, response, error: null });
      navigateForResponse(response);
    } catch (err: any) {
      setLastResult({ code, source, at, response: null, error: err.message });
    } finally {
      setBusy(false);
    }
  }, [navigateForResponse]);

  // Live refs so the capture listener stays installed across renders.
  const submitRef = useRef(submitCode);
  submitRef.current = submitCode;

  // The HID keyboard-wedge source: one capture-phase window listener sees
  // every key before focused inputs do; the burst machine decides which
  // keys belong to a scan and directs their suppression.
  useEffect(() => {
    if (!user || !enabled) return;
    const machine = createWedgeMachine(wedgeConfig);
    const onKeyDown = (e: KeyboardEvent) => {
      const { suppress, emit } = machine.step({
        key: e.key,
        timeMs: e.timeStamp,
        hasModifier: e.ctrlKey || e.metaKey || e.altKey,
        isRepeat: e.repeat,
      });
      if (suppress) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (emit) void submitRef.current(emit, SCAN_SOURCE_IDS.KEYBOARD_WEDGE);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [user, enabled, wedgeConfig]);

  const updateWedgeConfig = useCallback((patch: Partial<WedgeConfig>) => {
    setWedgeConfig(saveWedgeConfig(patch));
  }, []);

  const value = useMemo(
    () => ({ submitCode, lastResult, busy, wedgeConfig, updateWedgeConfig }),
    [submitCode, lastResult, busy, wedgeConfig, updateWedgeConfig],
  );

  return <ScanInputContext.Provider value={value}>{children}</ScanInputContext.Provider>;
}
