import { Navigate, Outlet } from 'react-router-dom';
import { useSettings } from '../../api/settings';

/**
 * Gates LLM-authoring routes (the Designer) so they're reachable only when an
 * Anthropic key is configured (ai.enabled === true), matching the nav gating.
 */
export function RequireAI({ redirectTo = '/' }: { redirectTo?: string }) {
  const { data, isLoading } = useSettings();

  // Wait for settings before deciding, so AI-on users aren't briefly redirected.
  if (isLoading || !data) return null;

  if (data.ai?.enabled) return <Outlet />;

  return <Navigate to={redirectTo} replace />;
}
