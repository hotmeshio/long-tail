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
}

interface ShellPanelContextValue extends ShellPanelState {
  setPanel: (node: ReactNode, opts?: { width?: number }) => void;
  closePanel: () => void;
}

const ShellPanelContext = createContext<ShellPanelContextValue | null>(null);

export function ShellPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShellPanelState>({
    node: null,
    width: DEFAULT_WIDTH,
    open: false,
  });
  const location = useLocation();
  const lastPath = useRef(location.pathname);

  const setPanel = useCallback((node: ReactNode, opts?: { width?: number }) => {
    setState({ node, width: opts?.width ?? DEFAULT_WIDTH, open: true });
  }, []);

  // Keep the node mounted while the width animates closed; SlidePanel
  // unmounts children itself when the transition ends.
  const closePanel = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  useEffect(() => {
    if (location.pathname !== lastPath.current) {
      lastPath.current = location.pathname;
      setState((prev) => (prev.open || prev.node ? { ...prev, node: null, open: false } : prev));
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
