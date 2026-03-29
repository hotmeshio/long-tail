import { useState, useEffect, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AppLogo } from '../components/common/display/AppLogo';
import { OAuthIcon } from '../components/common/OAuthIcon';

/**
 * Credential entry page for the Anthropic provider.
 *
 * Accepts either:
 *   - An OAuth token from `claude setup-token` (sk-ant-oat01-...) — uses your subscription
 *   - An API key from console.anthropic.com (sk-ant-api03-...) — billed per-token
 *
 * The credential is sent to the OAuth callback as the "code" parameter,
 * where it's validated and stored encrypted.
 *
 * Requires authentication — the user must be logged in first.
 */
export function ConnectAnthropicPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const state = params.get('state') || '';

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const [token, setToken] = useState('');
  const [label, setLabel] = useState(params.get('label') || 'default');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isOAuthToken = token.trim().startsWith('sk-ant-oat');
  const isApiKey = token.trim().startsWith('sk-ant-api');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();

    if (!trimmed) {
      setError('A token or API key is required');
      return;
    }

    if (!trimmed.startsWith('sk-ant-')) {
      setError('Invalid format. Must start with "sk-ant-oat" (OAuth token) or "sk-ant-api" (API key)');
      return;
    }

    setSubmitting(true);
    setError('');

    // Redirect to the OAuth callback with the credential as the "code"
    const callbackUrl = `/api/auth/oauth/anthropic/callback?code=${encodeURIComponent(trimmed)}&state=${encodeURIComponent(state)}`;
    window.location.href = callbackUrl;
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="w-full max-w-md p-10">
        <div className="mb-10">
          <AppLogo size="lg" />
        </div>

        <div className="flex items-center gap-2 mb-6">
          <OAuthIcon provider="anthropic" className="w-6 h-6" />
          <h2 className="text-lg font-semibold text-text-primary">
            Connect Anthropic
          </h2>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          Connect your Anthropic account so Claude Code tasks run under
          your credentials. Your token is encrypted at rest.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="token"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              OAuth Token or API Key
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="input"
              placeholder="sk-ant-oat01-... or sk-ant-api03-..."
              autoFocus
              autoComplete="off"
            />
            {isOAuthToken && (
              <p className="text-xs text-status-success mt-1">
                OAuth token detected — uses your Claude subscription (flat rate)
              </p>
            )}
            {isApiKey && (
              <p className="text-xs text-status-warning mt-1">
                API key detected — billed per-token from your Anthropic API account
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="label"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Label
            </label>
            <input
              id="label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value.replace(/\s+/g, '-').toLowerCase())}
              className="input"
              placeholder="default"
              autoComplete="off"
            />
            <p className="text-xs text-text-tertiary mt-1">
              A name for this credential. Use different labels to store multiple
              credentials (e.g., "subscription", "api-batch").
            </p>
          </div>

          {error && <p className="text-sm text-status-error">{error}</p>}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={submitting}
          >
            {submitting ? 'Validating...' : 'Connect'}
          </button>

          <a
            href="/"
            className="block text-center text-sm text-text-tertiary hover:text-text-secondary"
          >
            Cancel
          </a>
        </form>

        <div className="mt-6 space-y-3 text-xs text-text-tertiary">
          <div>
            <span className="font-medium text-text-secondary">Recommended:</span>{' '}
            Run{' '}
            <code className="px-1 py-0.5 bg-surface-sunken rounded text-[11px]">claude setup-token</code>{' '}
            in your terminal to generate an OAuth token that uses your subscription.
          </div>
          <div>
            <span className="font-medium text-text-secondary">Alternative:</span>{' '}
            Use an API key from{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-secondary hover:underline"
            >
              console.anthropic.com
            </a>{' '}
            (billed per-token).
          </div>
        </div>
      </div>
    </div>
  );
}
