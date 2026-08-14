import { useState, useRef, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { usePersona } from '../../hooks/usePersona';
import { useFollowMyClaims } from '../../hooks/useFollowMyClaims';
import { useKioskMode, isKioskAllowedPath } from '../../hooks/useKioskMode';
import { useSettings } from '../../api/settings';
import { getAiOverride } from '../../lib/view-as';
import { SidebarProvider, useSidebar } from '../../hooks/useSidebar';
import { ShellPanelProvider, useShellPanel } from '../../hooks/useShellPanel';
import { SlidePanel } from '../common/layout/SlidePanel';
import { Header } from './Header';
import { ShellNavSections } from './ShellNavSections';
import { NavDrawer } from './NavDrawer';
import { EventFeed } from './EventFeed';
import { DocsDrawer } from './DocsDrawer';
import { HelpButton } from './HelpButton';
import { HelpPanel } from './HelpPanel';
import { HelpAssistantProvider } from '../../hooks/useHelpAssistant';
import { ScanInputProvider } from '../../hooks/useScanInput';
import { ActingIdentityProvider } from '../../hooks/useActingIdentity';
import { ScanToast } from '../scan/ScanToast';
import { AnnouncementBanner } from './AnnouncementBanner';

/**
 * The canonical container layout. Every authenticated page renders inside it:
 *
 *   ┌──────────────── Header (full width) ────────────────┐
 *   │ left nav │        main viewport        │ right panel │
 *   └──────────────── EventFeed (full width) ─────────────┘
 *
 * - Header and EventFeed span the full width.
 * - The left nav and the global right SlidePanel are flex siblings of the
 *   main viewport — content narrows when either opens, nothing overlays it.
 *   Pages fill the right panel via useShellPanel().
 * - DocsDrawer is the full-screen overlay for markdown docs (#docs hash).
 * - Pages exempt from the shell: Login and OAuth connect flows only.
 */
function ShellLayout() {
  const { isBuilder, isOps, viewAs } = useAccess();
  const { canSeePaceBoard } = usePersona();
  // Claim hand-off: anything claimed in the viewer's name pulls them to it.
  useFollowMyClaims();
  const { data: settings } = useSettings();
  const aiOverride = getAiOverride();
  const aiEnabled = aiOverride !== null ? aiOverride : !!settings?.ai?.enabled;
  const { collapsed, toggle } = useSidebar();
  const [feedOpen, setFeedOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [feedConfigOpen, setFeedConfigOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(() => window.location.hash.startsWith('#docs'));
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  // Kiosk (locked station viewport): single-role members of a kiosk role get
  // no left nav and are held to the role list / detail / scan screens.
  const { kiosk, homePath } = useKioskMode();

  // Cross-fade on route change
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.classList.remove('animate-page-in');
    void el.offsetWidth;
    el.classList.add('animate-page-in');
  }, [location.pathname]);

  // Open docs drawer when hash changes to #docs
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith('#docs')) setDocsOpen(true);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Kiosk sessions live on the role list, the detail page, and the scan
  // screens; the home page and every other route redirect to the locked home.
  if (kiosk && homePath && !isKioskAllowedPath(location.pathname)) {
    return <Navigate to={homePath} replace />;
  }

  return (
    <div className="h-screen bg-surface flex flex-col">
      {/* Full-width header */}
      <Header
        onToggleEventFeed={() => setFeedOpen((v) => !v)}
        onToggleDocs={() => setDocsOpen((v) => !v)}
        onToggleNav={kiosk ? undefined : () => setNavOpen((v) => !v)}
      />

      {/* Broadcast notices — full width, under the header */}
      <AnnouncementBanner />

      {/* Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — the rail lives at lg+; below lg the NavDrawer is the nav.
            Kiosk sessions have no nav at all. */}
        {!kiosk && (
        <aside
          className={`${
            collapsed ? 'w-16' : 'w-60'
          } shrink-0 bg-surface-raised border-r border-surface-border hidden lg:flex flex-col transition-[width] duration-200 ease-out overflow-hidden relative z-20`}
        >
          {/* Nav */}
          <nav className="flex-1 px-3 pt-[36px] pb-4 space-y-2 overflow-y-auto overflow-x-hidden">
            <ShellNavSections aiEnabled={aiEnabled} isBuilder={isBuilder} isOps={isOps} viewAs={viewAs} canSeePaceBoard={canSeePaceBoard} />
          </nav>

          {/* Collapse / Expand toggle */}
          <button
            onClick={toggle}
            className={`shrink-0 py-3 text-text-tertiary hover:text-text-secondary transition-colors duration-150 ${
              collapsed ? 'flex justify-center' : 'flex items-center px-7'
            }`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4 text-accent-muted" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="w-4 h-4 text-accent-muted" strokeWidth={1.5} />
            )}
          </button>

          {/* Version line — long-tail + HotMesh SDK, shown when expanded. Single line. */}
          {!collapsed && settings?.environment && (
            <div
              className="shrink-0 px-5 pb-3 text-2xs leading-tight text-text-tertiary whitespace-nowrap overflow-hidden text-ellipsis"
              title={`long-tail v${settings.environment.longTailVersion} · HotMesh v${settings.environment.hotmeshVersion} · Node ${settings.environment.nodeVersion} · ${settings.environment.nodeEnv}`}
            >
              long-tail v{settings.environment.longTailVersion}
              <span className="mx-1 text-surface-border">·</span>
              HotMesh v{settings.environment.hotmeshVersion}
            </div>
          )}
        </aside>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {/* Full width — pages get all the room the window offers */}
          {/* The page-level container: page grids use @split/@wall/@table
              variants against THIS width, which shrinks when panels open. */}
          <div ref={contentRef} className="w-full px-page-x py-8 pb-16 animate-page-in h-full flex flex-col @container">
            <Outlet />
          </div>
        </main>

        {/* Global right panel — the mirror of the left nav. Pages populate it
            via useShellPanel(); it animates as a flex sibling so the main
            viewport narrows rather than being covered. */}
        <ShellRightPanel />
      </div>

      {/* Below-lg navigation drawer — absent in kiosk sessions. */}
      {!kiosk && (
        <NavDrawer
          open={navOpen}
          onClose={() => setNavOpen(false)}
          aiEnabled={aiEnabled}
          isBuilder={isBuilder}
          isOps={isOps}
          viewAs={viewAs}
          canSeePaceBoard={canSeePaceBoard}
        />
      )}

      {/* Global event feed */}
      <EventFeed open={feedOpen} onToggle={() => setFeedOpen((v) => !v)} configOpen={feedConfigOpen} onToggleConfig={() => setFeedConfigOpen((v) => !v)} />
      <DocsDrawer open={docsOpen} onClose={() => { setDocsOpen(false); history.replaceState(null, '', window.location.pathname + window.location.search); }} />
      {aiEnabled && <HelpButton />}
      {aiEnabled && <HelpPanel />}
      {/* Transient outcome notice for scans that answer without navigating. */}
      <ScanToast />
    </div>
  );
}

function ShellRightPanel() {
  const { node, width, open } = useShellPanel();
  return (
    <SlidePanel open={open} width={width} className="border-l border-surface-border bg-surface-raised">
      {node}
    </SlidePanel>
  );
}

export function Shell() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return (
    <SidebarProvider>
      <ShellPanelProvider>
        <HelpAssistantProvider>
          <ActingIdentityProvider>
            <ScanInputProvider>
              <ShellLayout />
            </ScanInputProvider>
          </ActingIdentityProvider>
        </HelpAssistantProvider>
      </ShellPanelProvider>
    </SidebarProvider>
  );
}
