import { Navigate, Outlet } from 'react-router-dom';
import { useSettings } from '../../api/settings';

/**
 * Gates HotMesh-only routes (graph flows, streams, processes, workflow
 * registry) so they're reachable only when HotMesh runs workflows,
 * matching the nav gating. Servers without an engine field run HotMesh.
 */
export function RequireNativeEngine({ redirectTo = '/' }: { redirectTo?: string }) {
  const { data, isLoading } = useSettings();

  // Wait for settings before deciding, so users aren't briefly redirected.
  if (isLoading || !data) return null;

  if (data.engine && !data.engine.native) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}
