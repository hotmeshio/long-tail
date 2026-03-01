import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { Shell } from './components/layout/Shell';
import { LoginPage } from './pages/LoginPage';
import { RequireRole } from './components/layout/RequireRole';

// ---------------------------------------------------------------------------
// Lazy-loaded route sections
// ---------------------------------------------------------------------------

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
const McpServersPage = lazy(() =>
  import('./pages/admin/mcp-servers').then((m) => ({ default: m.McpServersPage })),
);
const UsersPage = lazy(() =>
  import('./pages/admin/users').then((m) => ({ default: m.UsersPage })),
);
const EscalationChainsPage = lazy(() =>
  import('./pages/admin/escalation-chains').then((m) => ({ default: m.EscalationChainsPage })),
);
const UserRolesPage = lazy(() =>
  import('./pages/admin/user-roles').then((m) => ({ default: m.UserRolesPage })),
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
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

// ---------------------------------------------------------------------------
// Router & App
// ---------------------------------------------------------------------------

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      // Default -> escalations front page
      { index: true, element: <Navigate to="/escalations" replace /> },

      // Escalation section (all authenticated users)
      { path: 'escalations', element: <Lazy><EscalationsOverview /></Lazy> },
      { path: 'escalations/available', element: <Lazy><AvailableEscalationsPage /></Lazy> },
      { path: 'escalations/queue', element: <Lazy><OperatorDashboard /></Lazy> },
      { path: 'escalations/:id', element: <Lazy><EscalationDetailPage /></Lazy> },

      // Workflows section (engineer, admin, or superadmin)
      {
        element: <RequireRole roleTypes={['admin', 'superadmin']} roleNames={['engineer']} />,
        children: [
          { path: 'workflows', element: <Lazy><WorkflowsOverview /></Lazy> },
          { path: 'workflows/list', element: <Lazy><WorkflowsDashboard /></Lazy> },
          { path: 'workflows/tasks', element: <Lazy><TasksListPage /></Lazy> },
          { path: 'workflows/tasks/:id', element: <Lazy><TaskDetailPage /></Lazy> },
          { path: 'workflows/execution/:workflowId', element: <Lazy><WorkflowExecutionPage /></Lazy> },
          { path: 'workflows/start', element: <Lazy><StartWorkflowPage /></Lazy> },
        ],
      },

      // Admin section (admin or superadmin)
      {
        element: <RequireRole roleTypes={['admin', 'superadmin']} />,
        children: [
          { path: 'admin', element: <Lazy><AdminDashboard /></Lazy> },
          { path: 'admin/config', element: <Lazy><WorkflowConfigsPage /></Lazy> },
          { path: 'admin/mcp', element: <Lazy><McpServersPage /></Lazy> },
          { path: 'admin/users', element: <Lazy><UsersPage /></Lazy> },
          { path: 'admin/escalation-chains', element: <Lazy><EscalationChainsPage /></Lazy> },
          { path: 'admin/user-roles', element: <Lazy><UserRolesPage /></Lazy> },
          { path: 'admin/maintenance', element: <Lazy><MaintenancePage /></Lazy> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
