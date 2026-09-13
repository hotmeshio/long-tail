import { Navigate, Outlet } from 'react-router-dom';
import { useInvocableWorkflows } from '../../api/workflows';

/**
 * Route guard for the Invoke page: the server decides who may invoke what,
 * so the page is open to anyone and closed only when the caller's invokable
 * list has loaded empty. While loading, the page renders its own skeleton.
 */
export function RequireInvocable() {
  const { data, isSuccess } = useInvocableWorkflows();
  if (isSuccess && data.length === 0) return <Navigate to="/" replace />;
  return <Outlet />;
}
