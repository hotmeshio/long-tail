import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { NatsProvider } from './hooks/useNats';
import { Shell } from './components/layout/Shell';
import { LoginPage } from './pages/LoginPage';
import { RequireRole } from './components/layout/RequireRole';

// ---------------------------------------------------------------------------
// Lazy-loaded route sections
// ---------------------------------------------------------------------------

// Process pages (all authenticated users)
const ProcessesOverview = lazy(() =>
  import('./pages/processes/ProcessesOverview').then((m) => ({ default: m.ProcessesOverview })),
);
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
const WorkflowsDashboard = lazy(() =>
  import('./pages/workflows/WorkflowsDashboard').then((m) => ({ default: m.WorkflowsDashboard })),
);
const StartWorkflowPage = lazy(() =>
  import('./pages/workflows/StartWorkflowPage').then((m) => ({ default: m.StartWorkflowPage })),
);
const CronWorkflowsPage = lazy(() =>
  import('./pages/workflows/CronWorkflowsPage').then((m) => ({ default: m.CronWorkflowsPage })),
);
const YamlWorkflowsPage = lazy(() =>
  import('./pages/workflows/YamlWorkflowsPage').then((m) => ({ default: m.YamlWorkflowsPage })),
);
const YamlWorkflowDetailPage = lazy(() =>
  import('./pages/workflows/YamlWorkflowDetailPage').then((m) => ({ default: m.YamlWorkflowDetailPage })),
);
const TasksListPage = lazy(() =>
  import('./pages/admin/TasksListPage').then((m) => ({ default: m.TasksListPage })),
);
const TaskDetailPage = lazy(() =>
  import('./pages/admin/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
const WorkflowExecutionPage = lazy(() =>
  import('./pages/admin/WorkflowExecutionPage').then((m) => ({ default: m.WorkflowExecutionPage })),
);

// Admin pages (admin or superadmin)
const AdminDashboard = lazy(() =>
  import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })),
);
const WorkflowConfigsPage = lazy(() =>
  import('./pages/admin/workflow-configs').then((m) => ({ default: m.WorkflowConfigsPage })),
);
const WorkflowConfigDetailPage = lazy(() =>
  import('./pages/admin/workflow-configs').then((m) => ({ default: m.WorkflowConfigDetailPage })),
);
const McpServersPage = lazy(() =>
  import('./pages/admin/mcp-servers').then((m) => ({ default: m.McpServersPage })),
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

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      // Default -> processes overview (home page)
      { index: true, element: <Lazy><ProcessesOverview /></Lazy> },

      // Processes section (all authenticated users)
      { path: 'processes/runs', element: <Lazy><ProcessesListPage /></Lazy> },
      { path: 'processes/detail/:originId', element: <Lazy><ProcessDetailPage /></Lazy> },

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
          { path: 'workflows/runs', element: <Lazy><WorkflowsDashboard /></Lazy> },
          { path: 'workflows/tasks', element: <Lazy><TasksListPage /></Lazy> },
          { path: 'workflows/tasks/detail/:id', element: <Lazy><TaskDetailPage /></Lazy> },
          { path: 'workflows/detail/:workflowId', element: <Lazy><WorkflowExecutionPage /></Lazy> },
          { path: 'workflows/start', element: <Lazy><StartWorkflowPage /></Lazy> },
          { path: 'workflows/cron', element: <Lazy><CronWorkflowsPage /></Lazy> },
          { path: 'workflows/config', element: <Lazy><WorkflowConfigsPage /></Lazy> },
          { path: 'workflows/config/new', element: <Lazy><WorkflowConfigDetailPage /></Lazy> },
          { path: 'workflows/config/:workflowType', element: <Lazy><WorkflowConfigDetailPage /></Lazy> },
        ],
      },

      // MCP section (engineer, admin, or superadmin)
      {
        element: <RequireRole roleTypes={['admin', 'superadmin']} roleNames={['engineer']} />,
        children: [
          { path: 'mcp', element: <Lazy><McpOverview /></Lazy> },
          { path: 'mcp/tools', element: <Navigate to="/mcp/servers" replace /> },
          { path: 'mcp/servers', element: <Lazy><McpServersPage /></Lazy> },
          { path: 'mcp/workflows', element: <Lazy><YamlWorkflowsPage /></Lazy> },
          { path: 'mcp/workflows/:id', element: <Lazy><YamlWorkflowDetailPage /></Lazy> },
          { path: 'mcp/runs', element: <Lazy><McpRunsPage /></Lazy> },
          { path: 'mcp/runs/:jobId', element: <Lazy><McpRunDetailPage /></Lazy> },
        ],
      },

      // Admin section (admin or superadmin)
      {
        element: <RequireRole roleTypes={['admin', 'superadmin']} />,
        children: [
          { path: 'admin', element: <Lazy><AdminDashboard /></Lazy> },
          { path: 'admin/users', element: <Lazy><UsersPage /></Lazy> },
          { path: 'admin/escalation-chains', element: <Navigate to="/admin/roles" replace /> },
          { path: 'admin/roles', element: <Lazy><RolesPage /></Lazy> },
          { path: 'admin/maintenance', element: <Lazy><MaintenancePage /></Lazy> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NatsProvider>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </NatsProvider>
    </QueryClientProvider>
  );
}
