import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { SidebarProvider, useSidebar } from '../../hooks/useSidebar';
import { Header } from './Header';
import { ProcessesSidebar } from './ProcessesSidebar';
import { AdminSidebar } from './AdminSidebar';
import { EngineerSidebar } from './EngineerSidebar';
import { McpSidebar } from './McpSidebar';
import { OperatorSidebar } from './OperatorSidebar';

function ShellLayout() {
  const { isSuperAdmin, hasRoleType, hasRole } = useAuth();
  const { collapsed, toggle } = useSidebar();

  return (
    <div className="h-screen bg-surface flex flex-col">
      {/* Full-width header */}
      <Header />

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
            <ProcessesSidebar />
            {(isSuperAdmin || hasRoleType('admin') || hasRole('engineer')) && <EngineerSidebar />}
            {(isSuperAdmin || hasRoleType('admin') || hasRole('engineer')) && <McpSidebar />}
            <OperatorSidebar />
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
          <div className="max-w-dashboard mx-auto px-10 py-10">
            <Outlet />
          </div>
        </main>
      </div>
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
