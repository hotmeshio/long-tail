import { Navigate, Outlet } from 'react-router-dom';
import { useSettings } from '../../api/settings';

/**
 * Gates the Lines routes behind declared machine lines (settings.machines).
 * A deployment without lines sends the visitor home, matching the nav.
 */
export function RequireMachines({ redirectTo = '/' }: { redirectTo?: string }) {
  const { data, isLoading } = useSettings();

  if (isLoading || !data) return null;

  if (!data.machines) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}
