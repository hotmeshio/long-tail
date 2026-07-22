import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY = 'lt_sidebar_collapsed';

/* Below this width (iPad portrait and narrower) the expanded nav costs too
 * much of the viewport, so the sidebar defaults collapsed and re-collapses
 * when the window crosses down through the breakpoint. An explicit user
 * toggle still wins until the next crossing. */
const NARROW_QUERY = '(max-width: 1023px)';

function isNarrow(): boolean {
  try {
    return window.matchMedia(NARROW_QUERY).matches;
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (isNarrow()) return true;
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(NARROW_QUERY);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setCollapsed(true);
      } else {
        try {
          setCollapsed(localStorage.getItem(STORAGE_KEY) === 'true');
        } catch {
          setCollapsed(false);
        }
      }
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

/**
 * Forces the expanded presentation inside its subtree — the nav DRAWER always
 * shows labels, whatever the rail's collapsed state says.
 */
export function SidebarExpandedScope({ children }: { children: ReactNode }) {
  return (
    <SidebarContext.Provider value={{ collapsed: false, toggle: () => {} }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
