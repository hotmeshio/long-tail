import { Navigate, Outlet } from 'react-router-dom';
import { useSettings, type AppSettings } from '../../api/settings';

type FeatureFlag = keyof NonNullable<AppSettings['features']>;

/**
 * Gates a route behind a dashboard feature flag (settings.features.*).
 * Flags are default-on, so a route is blocked only when the deployment
 * explicitly sets the flag to `false` — matching the nav gating.
 */
export function RequireFeature({ flag, redirectTo = '/' }: { flag: FeatureFlag; redirectTo?: string }) {
  const { data, isLoading } = useSettings();

  // Wait for settings before deciding, so users aren't briefly redirected.
  if (isLoading || !data) return null;

  if (data.features?.[flag] === false) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}
