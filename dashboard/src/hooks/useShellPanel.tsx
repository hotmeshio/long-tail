import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Global right-panel slot — the right-hand mirror of the left nav. Any page
 * can slide content into the shell's SlidePanel without owning the layout:
 *
 *   const { setPanel, closePanel } = useShellPanel();
 *   setPanel(<MyPanelContent />, { width: 384 });
 *
 * The panel closes (with its slide animation) on route change, so pages never
 * leak a stale panel into the next view. Pages that need a page-scoped panel
 * with bespoke positioning (e.g. the escalation detail side panel) may still
 * render SlidePanel inline; this slot is the default for everything else.
 */

const DEFAULT_WIDTH = 380;

interface ShellPanelState {
  node: ReactNode | null;
  width: number;
  open: boolean;
  /** Which claimant set the current content — the slot is shared. */
  ownerKey: string | null;
}

interface ShellPanelContextValue extends ShellPanelState {
  setPanel: (node: ReactNode, opts?: { width?: number; key?: string }) => void;
  closePanel: (key?: string) => void;
}

const ShellPanelContext = createContext<ShellPanelContextValue | null>(null);

export function ShellPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShellPanelState>({
    node: null,
    width: DEFAULT_WIDTH,
    open: false,
    ownerKey: null,
  });
  const location = useLocation();
  const lastPath = useRef(location.pathname);

  // ONE slot, keyed ownership: setPanel with a key claims the slot (last
  // claim wins — a click is intent); a keyed closePanel only closes content
  // the caller still owns, so one claimant's teardown can never yank another
  // claimant's live panel. Claimants watch `ownerKey` and stand down when
  // the slot is taken from them.
  const setPanel = useCallback((node: ReactNode, opts?: { width?: number; key?: string }) => {
    setState({ node, width: opts?.width ?? DEFAULT_WIDTH, open: true, ownerKey: opts?.key ?? null });
  }, []);

  // Keep the node mounted while the width animates closed; SlidePanel
  // unmounts children itself when the transition ends. Callers may pass
  // closePanel directly as an event handler, so only a string arg is a key.
  const closePanel = useCallback((key?: unknown) => {
    setState((prev) =>
      typeof key === 'string' && prev.ownerKey !== key ? prev : { ...prev, open: false },
    );
  }, []);

  useEffect(() => {
    if (location.pathname !== lastPath.current) {
      lastPath.current = location.pathname;
      setState((prev) =>
        prev.open || prev.node ? { ...prev, node: null, open: false, ownerKey: null } : prev,
      );
    }
  }, [location.pathname]);

  return (
    <ShellPanelContext.Provider value={{ ...state, setPanel, closePanel }}>
      {children}
    </ShellPanelContext.Provider>
  );
}

export function useShellPanel(): ShellPanelContextValue {
  const ctx = useContext(ShellPanelContext);
  if (!ctx) throw new Error('useShellPanel must be used within ShellPanelProvider');
  return ctx;
}

/** Null outside the shell (tests, standalone surfaces) — callers degrade. */
export function useShellPanelOptional(): ShellPanelContextValue | null {
  return useContext(ShellPanelContext);
}
