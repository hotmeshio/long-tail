import { useState, useRef, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { SidebarProvider, useSidebar } from '../../hooks/useSidebar';
import { Header } from './Header';
import { AdminSidebar } from './AdminSidebar';
import { EngineerSidebar } from './EngineerSidebar';
import { McpSidebar } from './McpSidebar';
import { EventFeed } from './EventFeed';

function ShellLayout() {
  const { isSuperAdmin, hasRoleType, hasRole } = useAuth();
  const { collapsed, toggle } = useSidebar();
  const [feedOpen, setFeedOpen] = useState(false);
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

  return (
    <div className="h-screen bg-surface flex flex-col" style={{ '--feed-height': feedOpen ? '224px' : '32px' } as React.CSSProperties}>
      {/* Full-width header */}
      <Header onToggleEventFeed={() => setFeedOpen((v) => !v)} />

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
            {(isSuperAdmin || hasRoleType('admin') || hasRole('engineer')) && <EngineerSidebar />}
            {(isSuperAdmin || hasRoleType('admin') || hasRole('engineer')) && <McpSidebar />}
            {(isSuperAdmin || hasRoleType('admin')) && <AdminSidebar />}
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
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div ref={contentRef} className={`max-w-dashboard mx-auto px-10 py-10 animate-page-in ${feedOpen ? 'pb-60' : 'pb-16'}`}>
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global event feed */}
      <EventFeed open={feedOpen} onToggle={() => setFeedOpen((v) => !v)} />
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
      <ShellLayout />
    </SidebarProvider>
  );
}
