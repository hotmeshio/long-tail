import { Navigate, Outlet } from 'react-router-dom';
import { useSettings } from '../../api/settings';

/**
 * Gates routes behind the AI add-on. When no Anthropic key is configured
 * (ai.enabled === false), the Designer and other LLM-authoring surfaces are
 * neither shown in the nav nor reachable by URL. Choreography and orchestration
 * stand on their own without it.
 */
export function RequireAI({ redirectTo = '/' }: { redirectTo?: string }) {
  const { data, isLoading } = useSettings();

  // Wait for settings before deciding, so AI-on users aren't briefly redirected.
  if (isLoading || !data) return null;

  if (data.ai?.enabled) return <Outlet />;

  return <Navigate to={redirectTo} replace />;
}
