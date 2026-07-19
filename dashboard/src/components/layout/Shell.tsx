import { useState, useRef, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { useSettings } from '../../api/settings';
import { getAiOverride } from '../../lib/view-as';
import { SidebarProvider, useSidebar } from '../../hooks/useSidebar';
import { Header } from './Header';
import { ChoreographySidebar } from './ChoreographySidebar';
import { TaskQueuesSidebar } from './TaskQueuesSidebar';
import { OrchestrationSidebar } from './OrchestrationSidebar';
import { DesignSidebar } from './DesignSidebar';
import { StorageSidebar } from './StorageSidebar';
import { AdminSidebar } from './AdminSidebar';
import { EventFeed } from './EventFeed';
import { DocsDrawer } from './DocsDrawer';
import { HelpButton } from './HelpButton';
import { HelpPanel } from './HelpPanel';
import { HelpAssistantProvider } from '../../hooks/useHelpAssistant';

function ShellLayout() {
  const { isBuilder, isOps, viewAs } = useAccess();
  const { data: settings } = useSettings();
  const aiOverride = getAiOverride();
  const aiEnabled = aiOverride !== null ? aiOverride : !!settings?.ai?.enabled;
  const { collapsed, toggle } = useSidebar();
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedConfigOpen, setFeedConfigOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(() => window.location.hash.startsWith('#docs'));
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="h-screen bg-surface flex flex-col">
      {/* Full-width header */}
      <Header onToggleEventFeed={() => setFeedOpen((v) => !v)} onToggleDocs={() => setDocsOpen((v) => !v)} />

      {/* Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`${
            collapsed ? 'w-16' : 'w-60'
          } shrink-0 bg-surface-raised border-r border-surface-border flex flex-col transition-[width] duration-200 ease-out overflow-hidden relative z-20`}
        >
          {/* Nav */}
          <nav className="flex-1 px-3 pt-[36px] pb-4 space-y-2 overflow-y-auto overflow-x-hidden">
            <ChoreographySidebar aiEnabled={aiEnabled} isBuilder={isBuilder} isOps={isOps} viewAs={viewAs} />
            <TaskQueuesSidebar />
            {isBuilder && <OrchestrationSidebar />}
            {isBuilder && aiEnabled && <DesignSidebar />}
            {isBuilder && <StorageSidebar />}
            {(isBuilder || isOps) && <AdminSidebar isBuilder={isBuilder} isOps={isOps} />}
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
              className="shrink-0 px-5 pb-3 text-[10px] leading-tight text-text-tertiary whitespace-nowrap overflow-hidden text-ellipsis"
              title={`long-tail v${settings.environment.longTailVersion} · HotMesh v${settings.environment.hotmeshVersion} · Node ${settings.environment.nodeVersion} · ${settings.environment.nodeEnv}`}
            >
              long-tail v{settings.environment.longTailVersion}
              <span className="mx-1 text-surface-border">·</span>
              HotMesh v{settings.environment.hotmeshVersion}
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {/* Full width — pages get all the room the window offers */}
          <div ref={contentRef} className="w-full px-10 py-10 pb-16 animate-page-in h-full flex flex-col">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global event feed */}
      <EventFeed open={feedOpen} onToggle={() => setFeedOpen((v) => !v)} configOpen={feedConfigOpen} onToggleConfig={() => setFeedConfigOpen((v) => !v)} />
      <DocsDrawer open={docsOpen} onClose={() => { setDocsOpen(false); history.replaceState(null, '', window.location.pathname + window.location.search); }} />
      {aiEnabled && <HelpButton />}
      {aiEnabled && <HelpPanel />}
    </div>
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
      <HelpAssistantProvider>
        <ShellLayout />
      </HelpAssistantProvider>
    </SidebarProvider>
  );
}
