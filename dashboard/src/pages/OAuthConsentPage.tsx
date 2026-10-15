import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AppLogo } from '../components/common/display/AppLogo';
import { DictionaryList } from '../components/escalation/resolver-form/DictionaryList';
import {
  useOAuthClient,
  useGrantablePresets,
  useConsentDecision,
  type AuthorizationRequest,
  type GrantPreset,
} from '../api/oauth-server';

const REQUEST_FIELDS = [
  'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method',
  'response_type', 'state', 'scope', 'resource',
] as const;

const PRESET_COPY: Record<GrantPreset, { action: string; effect: string }> = {
  read_only: {
    action: 'Allow read-only',
    effect: 'Reads what you can read and runs workflows marked read-safe.',
  },
  just_me: {
    action: 'Allow as me',
    effect: 'Acts with your full rights: claims, resolves, invokes, and administers wherever you may.',
  },
};

function readRequest(search: string): AuthorizationRequest | null {
  const params = new URLSearchParams(search);
  const entries = REQUEST_FIELDS.map((key) => [key, params.get(key) ?? undefined] as const);
  const request = Object.fromEntries(entries) as Partial<AuthorizationRequest>;
  if (!request.client_id || !request.redirect_uri || !request.code_challenge) return null;
  return request as AuthorizationRequest;
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

/**
 * The OAuth consent page: an MCP client asks to act for the signed-in person.
 * The person grants read-only access or their full rights, or denies. The
 * server re-validates the request on every decision.
 */
export function OAuthConsentPage() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const request = useMemo(() => readRequest(location.search), [location.search]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const client = useOAuthClient(isAuthenticated && request ? request.client_id : null);
  const presets = useGrantablePresets(isAuthenticated && !!request);
  const decide = useConsentDecision();

  const decideAndLeave = (preset: GrantPreset | null) => {
    if (!request) return;
    decide.mutate({ request, preset }, { onSuccess: ({ redirect }) => window.location.assign(redirect) });
  };

  if (!isAuthenticated) return null;

  const invalid = !request || client.isError;
  const appName = client.data?.client_name || 'An app';

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="w-full max-w-lg p-10">
        <div className="mb-10">
          <AppLogo size="lg" />
        </div>

        {invalid ? (
          <div role="alert">
            <h2 className="heading-3 mb-3">Sign-in link not valid</h2>
            <p className="text-sm text-text-secondary">
              Start the connection again from the app.
            </p>
          </div>
        ) : (
          <>
            <h2 className="heading-2 mb-2">Connect {appName}</h2>
            <p className="text-sm text-text-secondary mb-6">
              Pick how much {appName} may do as you. Disconnect it any time under Connected apps.
            </p>

            <div className="mb-8">
              <DictionaryList items={[
                { key: 'app', label: 'App', value: appName },
                { key: 'account', label: 'Account', value: user?.displayName || user?.username || user?.userId || null },
                { key: 'returns-to', label: 'Returns to', value: hostOf(request.redirect_uri) },
                { key: 'deployment', label: 'Deployment', value: window.location.host },
              ]} />
            </div>

            <dl className="space-y-3 mb-8">
              {(presets.data?.presets ?? []).map((preset) => (
                <div key={preset}>
                  <dt className="text-sm font-medium text-text-primary">{PRESET_COPY[preset].action}</dt>
                  <dd className="text-sm text-text-secondary">{PRESET_COPY[preset].effect}</dd>
                </div>
              ))}
            </dl>

            {decide.isError && (
              <p className="text-sm text-status-error mb-4" role="alert">
                {(decide.error as Error).message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {(presets.data?.presets ?? []).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={preset === 'read_only' ? 'btn-primary' : 'btn-secondary'}
                  disabled={decide.isPending || client.isLoading}
                  onClick={() => decideAndLeave(preset)}
                >
                  {PRESET_COPY[preset].action}
                </button>
              ))}
              <button
                type="button"
                className="btn-ghost"
                disabled={decide.isPending}
                onClick={() => decideAndLeave(null)}
              >
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
