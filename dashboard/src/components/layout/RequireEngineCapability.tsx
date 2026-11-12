import { Navigate, Outlet } from 'react-router-dom';
import { useSettings, type EngineSettings } from '../../api/settings';

/**
 * Gates a route on one engine capability. HotMesh has every capability, as
 * does a server without an engine field; another engine needs the flag.
 */
export function RequireEngineCapability({ capability, redirectTo = '/' }: {
  capability: keyof EngineSettings['capabilities'];
  redirectTo?: string;
}) {
  const { data, isLoading } = useSettings();

  // Wait for settings before deciding, so users aren't briefly redirected.
  if (isLoading || !data) return null;

  const engine = data.engine;
  if (engine && !engine.native && !engine.capabilities?.[capability]) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}
