import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { EventTransportProvider } from './hooks/useEventTransport';
import { Shell } from './components/layout/Shell';
import { LoginPage } from './pages/LoginPage';
import { ConnectAnthropicPage } from './pages/ConnectAnthropicPage';
import { RequireRole } from './components/layout/RequireRole';

// ---------------------------------------------------------------------------
// Lazy-loaded route sections
// ---------------------------------------------------------------------------

// Process pages (all authenticated users)
const ProcessesListPage = lazy(() =>
  import('./pages/processes/ProcessesListPage').then((m) => ({ default: m.ProcessesListPage })),
);
const ProcessDetailPage = lazy(() =>
  import('./pages/processes/ProcessDetailPage').then((m) => ({ default: m.ProcessDetailPage })),
);
// MCP pages (engineer, admin, or superadmin)
const McpOverview = lazy(() =>
  import('./pages/mcp/McpOverview').then((m) => ({ default: m.McpOverview })),
);
// McpToolsPage removed — tools are now inline in the Servers page
const McpRunsPage = lazy(() =>
  import('./pages/mcp/McpRunsPage').then((m) => ({ default: m.McpRunsPage })),
);
const McpRunDetailPage = lazy(() =>
  import('./pages/mcp/McpRunDetailPage').then((m) => ({ default: m.McpRunDetailPage })),
);
const McpQueryPage = lazy(() =>
  import('./pages/mcp/McpQueryPage').then((m) => ({ default: m.McpQueryPage })),
);
const McpQueryDetailPage = lazy(() =>
  import('./pages/mcp/mcp-query-detail/McpQueryDetailPage').then((m) => ({ default: m.McpQueryDetailPage })),
);
// Escalation pages (all authenticated users)
const EscalationsOverview = lazy(() =>
  import('./pages/operator/EscalationsOverview').then((m) => ({ default: m.EscalationsOverview })),
);
const AvailableEscalationsPage = lazy(() =>
  import('./pages/operator/AvailableEscalationsPage').then((m) => ({ default: m.AvailableEscalationsPage })),
);
const OperatorDashboard = lazy(() =>
  import('./pages/operator/OperatorDashboard').then((m) => ({ default: m.OperatorDashboard })),
);
const EscalationDetailPage = lazy(() =>
  import('./pages/operator/escalation-detail').then((m) => ({ default: m.EscalationDetailPage })),
);

// Workflow pages (engineer role)
const WorkflowsOverview = lazy(() =>
  import('./pages/workflows/WorkflowsOverview').then((m) => ({ default: m.WorkflowsOverview })),
);
const StartWorkflowPage = lazy(() =>
  import('./pages/workflows/start').then((m) => ({ default: m.StartWorkflowPage })),
);
const DurableInvokePage = lazy(() =>
  import('./pages/workflows/start').then((m) => ({ default: m.DurableInvokePage })),
);
const DurableExecutionsPage = lazy(() =>
  import('./pages/workflows/WorkflowsDashboard').then((m) => ({
    default: () => m.WorkflowsDashboard({ tier: 'durable' }),
  })),
);
const CertifiedExecutionsPage = lazy(() =>
  import('./pages/workflows/WorkflowsDashboard').then((m) => ({
    default: () => m.WorkflowsDashboard({ tier: 'all' }),
  })),
);
const YamlWorkflowsPage = lazy(() =>
  import('./pages/workflows/YamlWorkflowsPage').then((m) => ({ default: m.YamlWorkflowsPage })),
);
const TasksListPage = lazy(() =>
  import('./pages/workflows/TasksListPage').then((m) => ({ default: m.TasksListPage })),
);
const TaskDetailPage = lazy(() =>
  import('./pages/workflows/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
const WorkflowExecutionPage = lazy(() =>
  import('./pages/workflows/WorkflowExecutionPage').then((m) => ({ default: m.WorkflowExecutionPage })),
);

// Admin pages (admin or superadmin)
const AdminDashboard = lazy(() =>
  import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })),
);
const WorkersPage = lazy(() =>
  import('./pages/workflows/workers').then((m) => ({ default: m.WorkersPage })),
);
const WorkflowConfigsPage = lazy(() =>
  import('./pages/workflows/registry').then((m) => ({ default: m.WorkflowConfigsPage })),
);
const WorkflowConfigDetailPage = lazy(() =>
  import('./pages/workflows/registry').then((m) => ({ default: m.WorkflowConfigDetailPage })),
);
const McpServersPage = lazy(() =>
  import('./pages/mcp/servers').then((m) => ({ default: m.McpServersPage })),
);
const McpServerDetailPage = lazy(() =>
  import('./pages/mcp/servers/detail').then((m) => ({ default: m.McpServerDetailPage })),
);
const UsersPage = lazy(() =>
  import('./pages/admin/users').then((m) => ({ default: m.UsersPage })),
);
const RolesPage = lazy(() =>
  import('./pages/admin/roles/RolesPage').then((m) => ({ default: m.RolesPage })),
);
const MaintenancePage = lazy(() =>
  import('./pages/admin/maintenance').then((m) => ({ default: m.MaintenancePage })),
);
const ControlPlanePage = lazy(() =>
  import('./pages/admin/controlplane').then((m) => ({ default: m.ControlPlanePage })),
);
// BotsPage is now embedded in the unified Accounts page (UsersPage)
const CredentialsPage = lazy(() =>
  import('./pages/settings/CredentialsPage').then((m) => ({ default: m.CredentialsPage })),
);

// ---------------------------------------------------------------------------
// Suspense fallback
// ---------------------------------------------------------------------------

function PageLoader() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-surface-sunken rounded w-48" />
      <div className="h-40 bg-surface-sunken rounded" />
    </div>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <div className="animate-page-enter">{children}</div>
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Router & App
// ---------------------------------------------------------------------------

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (failureCount, error) => {
        // Don't retry auth errors — apiFetch handles refresh internally
        if (error instanceof Error && error.message === 'Session expired') return false;
        return failureCount < 1;
      },
    },
  },
});

// Force immediate redirect on auth failure — don't wait for React state batching.
// This prevents the "empty pages" scenario where queries error silently and
// components render `data?.items ?? []` as empty arrays before logout propagates.
window.addEventListener('auth:unauthorized', () => {
  queryClient.clear();
  sessionStorage.removeItem('lt_token');
  sessionStorage.removeItem('lt_credentials');
  sessionStorage.removeItem('lt_user_info');
  if (window.location.pathname !== '/login') {
    window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
  }
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/connect/anthropic', element: <ConnectAnthropicPage /> },
  { path: '/connect/:provider', element: <ConnectAnthropicPage /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      // Default -> processes overview (home page)
      { index: true, element: <Lazy><ProcessesListPage /></Lazy> },

      // Processes section (all authenticated users)
      { path: 'processes/all', element: <Lazy><ProcessesListPage /></Lazy> },
      { path: 'processes/detail/:originId', element: <Lazy><ProcessDetailPage /></Lazy> },

      // Credentials (all authenticated users) — legacy path redirects
      { path: 'credentials', element: <Lazy><CredentialsPage /></Lazy> },
      { path: 'connections', element: <Navigate to="/credentials" replace /> },

      // Escalation section (all authenticated users)
      { path: 'escalations', element: <Lazy><EscalationsOverview /></Lazy> },
      { path: 'escalations/available', element: <Lazy><AvailableEscalationsPage /></Lazy> },
      { path: 'escalations/queue', element: <Lazy><OperatorDashboard /></Lazy> },
      { path: 'escalations/detail/:id', element: <Lazy><EscalationDetailPage /></Lazy> },

      // Workflows section (engineer, admin, or superadmin)
      {
        element: <RequireRole roleTypes={['admin', 'superadmin']} roleNames={['engineer']} />,
        children: [
          { path: 'workflows', element: <Lazy><WorkflowsOverview /></Lazy> },
          { path: 'workflows/executions', element: <Lazy><CertifiedExecutionsPage /></Lazy> },
          { path: 'workflows/durable/executions', element: <Lazy><DurableExecutionsPage /></Lazy> },
          { path: 'workflows/durable/executions/:workflowId', element: <Lazy><WorkflowExecutionPage /></Lazy> },
          { path: 'workflows/tasks', element: <Lazy><TasksListPage /></Lazy> },
          { path: 'workflows/tasks/detail/:id', element: <Lazy><TaskDetailPage /></Lazy> },
          { path: 'workflows/executions/:workflowId', element: <Lazy><WorkflowExecutionPage /></Lazy> },
          { path: 'workflows/start', element: <Lazy><StartWorkflowPage /></Lazy> },
          { path: 'workflows/durable/invoke', element: <Lazy><DurableInvokePage /></Lazy> },
          { path: 'workflows/cron', element: <Navigate to="/workflows/start?mode=schedule" replace /> },
          { path: 'workflows/workers', element: <Lazy><WorkersPage /></Lazy> },
          { path: 'workflows/registry', element: <Lazy><WorkflowConfigsPage /></Lazy> },
          { path: 'workflows/registry/new', element: <Lazy><WorkflowConfigDetailPage /></Lazy> },
          { path: 'workflows/registry/:workflowType', element: <Lazy><WorkflowConfigDetailPage /></Lazy> },
        ],
      },

      // MCP section (engineer, admin, or superadmin)
      {
        element: <RequireRole roleTypes={['admin', 'superadmin']} roleNames={['engineer']} />,
        children: [
          { path: 'mcp', element: <Lazy><McpOverview /></Lazy> },
          { path: 'mcp/queries', element: <Lazy><McpQueryPage /></Lazy> },
          { path: 'mcp/queries/:workflowId', element: <Lazy><McpQueryDetailPage /></Lazy> },
          { path: 'mcp/tools', element: <Navigate to="/mcp/servers" replace /> },
          { path: 'mcp/servers', element: <Lazy><McpServersPage /></Lazy> },
          { path: 'mcp/servers/new', element: <Lazy><McpServerDetailPage /></Lazy> },
          { path: 'mcp/servers/:serverId', element: <Lazy><McpServerDetailPage /></Lazy> },
          { path: 'mcp/workflows', element: <Lazy><YamlWorkflowsPage /></Lazy> },
          { path: 'mcp/executions', element: <Lazy><McpRunsPage /></Lazy> },
          { path: 'mcp/executions/:jobId', element: <Lazy><McpRunDetailPage /></Lazy> },
        ],
      },

      // Admin section (admin or superadmin)
      {
        element: <RequireRole roleTypes={['admin', 'superadmin']} />,
        children: [
          { path: 'admin', element: <Lazy><AdminDashboard /></Lazy> },
          { path: 'admin/users', element: <Lazy><UsersPage /></Lazy> },
          { path: 'admin/bots', element: <Navigate to="/admin/users?tab=service-accounts" replace /> },
          { path: 'admin/escalation-chains', element: <Navigate to="/admin/roles" replace /> },
          { path: 'admin/roles', element: <Lazy><RolesPage /></Lazy> },
          { path: 'admin/maintenance', element: <Lazy><MaintenancePage /></Lazy> },
          { path: 'admin/controlplane', element: <Lazy><ControlPlanePage /></Lazy> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <EventTransportProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </EventTransportProvider>
    </QueryClientProvider>
  );
}
