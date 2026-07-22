import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { ShellNavSections, type ShellNavSectionsProps } from './ShellNavSections';
import { SidebarExpandedScope } from '../../hooks/useSidebar';

/**
 * The below-lg navigation drawer — the left mirror of the DocsDrawer pattern.
 * Nav is transient, so an overlay is lawful here (the no-overlay rule guards
 * content panels). Closes on scrim tap, X, or route change.
 */
export function NavDrawer({ open, onClose, ...nav }: {
  open: boolean;
  onClose: () => void;
} & ShellNavSectionsProps) {
  const location = useLocation();

  // A navigation drawer's job ends the moment navigation happens.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <div className={`lg:hidden fixed inset-y-0 left-0 z-40 flex ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`fixed inset-0 bg-black/20 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`relative w-72 max-w-[85vw] h-full bg-surface-raised border-r border-surface-border shadow-xl flex flex-col transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-end px-3 pt-3 shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 px-3 pb-4 space-y-2 overflow-y-auto overflow-x-hidden">
          {/* The drawer is always the expanded nav — labels, never bare icons. */}
          <SidebarExpandedScope>
            <ShellNavSections {...nav} />
          </SidebarExpandedScope>
        </nav>
      </div>
    </div>
  );
}
