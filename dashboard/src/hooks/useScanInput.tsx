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
import { removeFromActiveEditable } from '../lib/scan-sources/editable-repair';
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

/** One observed keydown, as the capture machine saw it. */
export interface ScanKeyDiag {
  seq: number;
  key: string;
  /** KeyboardEvent.code when it names a different physical key. */
  code: string;
  /** ms since the previous observed keydown. */
  deltaMs: number;
  /** Accumulator contents after this key. */
  buffer: string;
  note: string;
}

interface ScanInputContextValue {
  /** Submit a code from any source (manual entry, tests). */
  submitCode(code: string, source?: string): Promise<void>;
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
  const [diagnostics, setDiagnostics] = useState<ScanKeyDiag[]>([]);
  const [diagnosticsOn, setDiagnosticsOn] = useState(false);
  const diagnosticsOnRef = useRef(diagnosticsOn);
  diagnosticsOnRef.current = diagnosticsOn;
  const diagSeqRef = useRef(0);
  const lastKeyAtRef = useRef(0);

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
    let autoFireTimer: ReturnType<typeof setTimeout> | null = null;

    const clearAutoFire = () => {
      if (autoFireTimer) { clearTimeout(autoFireTimer); autoFireTimer = null; }
    };

    const fire = (code: string, consumedLength: number, note: string) => {
      if (consumedLength) removeFromActiveEditable(consumedLength);
      if (diagnosticsOnRef.current) {
        const entry: ScanKeyDiag = {
          seq: ++diagSeqRef.current, key: '(quiet)', code: '', deltaMs: 0, buffer: '', note,
        };
        // eslint-disable-next-line no-console
        console.debug('[scan]', note);
        setDiagnostics((prev) => [...prev.slice(-29), entry]);
      }
      void submitRef.current(code, SCAN_SOURCE_IDS.KEYBOARD_WEDGE);
    };

    // Scanners with no suffix programmed never send a terminator — when the
    // buffer ends in a full code typed at scanner speed, a quiet period
    // stands in for the Enter.
    const scheduleAutoFire = () => {
      clearAutoFire();
      if (!machine.pendingAutoFire()) return;
      autoFireTimer = setTimeout(() => {
        autoFireTimer = null;
        const pending = machine.pendingAutoFire();
        if (!pending) return;
        machine.reset();
        fire(pending.code, pending.consumedLength, `capture → ${pending.code} (quiet period — no suffix)`);
      }, wedgeConfig.autoFireQuietMs);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const bufferBefore = machine.snapshot().buffer;
      const { suppress, emit, consumedLength } = machine.step({
        key: e.key,
        timeMs: e.timeStamp,
        hasModifier: e.ctrlKey || e.metaKey || e.altKey,
        isRepeat: e.repeat,
      });
      if (suppress) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Diagnostics: what the machine saw and what it decided, key by key —
      // the panel view for chasing scanner-specific stream shapes.
      if (diagnosticsOnRef.current) {
        const bufferAfter = machine.snapshot().buffer;
        const isTerminator = wedgeConfig.terminators.includes(e.key);
        const note = emit
          ? `capture → ${emit}`
          : isTerminator
            ? `terminator — no code tail in "${bufferBefore.slice(-24)}"`
            : bufferAfter === bufferBefore
              ? bufferBefore ? 'neutral (chord key)' : 'ignored'
              : bufferAfter === ''
                ? 'reset (edit/chord/non-printable)'
                : bufferAfter.length <= 1 && bufferBefore.length > 1
                  ? 'gap — new episode'
                  : 'accumulate';
        const deltaMs = lastKeyAtRef.current ? Math.round(e.timeStamp - lastKeyAtRef.current) : 0;
        const entry: ScanKeyDiag = {
          seq: ++diagSeqRef.current,
          key: e.key,
          code: e.code !== e.key ? e.code : '',
          deltaMs,
          buffer: bufferAfter.slice(-24),
          note,
        };
        // eslint-disable-next-line no-console
        console.debug('[scan]', entry.key, entry.code, `${entry.deltaMs}ms`, entry.note);
        setDiagnostics((prev) => [...prev.slice(-29), entry]);
      }
      lastKeyAtRef.current = e.timeStamp;

      // The code's characters typed into whatever holds focus; strip exactly
      // them back out before executing. Cursor focus never diverts a scan.
      if (emit) {
        clearAutoFire();
        if (consumedLength) removeFromActiveEditable(consumedLength);
        void submitRef.current(emit, SCAN_SOURCE_IDS.KEYBOARD_WEDGE);
      } else {
        scheduleAutoFire();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      clearAutoFire();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [user, enabled, wedgeConfig]);

  const updateWedgeConfig = useCallback((patch: Partial<WedgeConfig>) => {
    setWedgeConfig(saveWedgeConfig(patch));
  }, []);

  const value = useMemo(
    () => ({ submitCode, lastResult, busy, wedgeConfig, updateWedgeConfig, diagnostics, diagnosticsOn, setDiagnosticsOn }),
    [submitCode, lastResult, busy, wedgeConfig, updateWedgeConfig, diagnostics, diagnosticsOn],
  );

  return <ScanInputContext.Provider value={value}>{children}</ScanInputContext.Provider>;
}
