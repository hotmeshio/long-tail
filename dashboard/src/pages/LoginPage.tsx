import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AppLogo } from '../components/common/display/AppLogo';
import { OAuthIcon } from '../components/common/OAuthIcon';
import { fetchOAuthProviders, type OAuthProvider } from '../api/oauth';

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const oauthToken = params.get('token');
  const oauthError = params.get('error');
  const returnTo = (location.state as { from?: string })?.from
    ?? params.get('returnTo')
    ?? '/';

  // Process the OAuth token immediately on first render (not in an effect)
  const oauthHandled = useRef(false);
  if (oauthToken && !oauthHandled.current) {
    oauthHandled.current = true;
    login(oauthToken, undefined, {
      displayName: params.get('displayName'),
      username: params.get('username'),
    });
  }

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(oauthError || '');
  const [loading, setLoading] = useState(false);
  const [launched, setLaunched] = useState(!!oauthToken);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);

  // Fetch available OAuth providers on mount
  useEffect(() => {
    if (oauthToken) return; // skip fetch during OAuth callback
    fetchOAuthProviders()
      .then(setOauthProviders)
      .catch(() => {});
  }, []);

  // Navigate after the comet animation completes
  useEffect(() => {
    if (!launched) return;
    const timer = setTimeout(() => navigate(returnTo, { replace: true }), 1500);
    return () => clearTimeout(timer);
  }, [launched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Already authenticated (e.g., navigated to /login while logged in) — skip animation
  if (isAuthenticated && !launched) {
    return <Navigate to={returnTo} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      setLaunched(true);
      login(
        data.token,
        { username: username.trim(), password },
        { displayName: data.user?.display_name, username: data.user?.external_id },
      );
    } catch {
      setError('Unable to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center overflow-hidden">
      <div className="w-full max-w-md p-10">
        <div
          className={`mb-10 transition-all duration-[1500ms] ease-in ${
            launched
              ? 'translate-x-[120vw] -translate-y-[60vh] scale-[3] opacity-0'
              : ''
          }`}
        >
          <AppLogo size="lg" hideLabel={launched} />
        </div>

        <form
          onSubmit={handleSubmit}
          className={`space-y-5 transition-opacity duration-300 ${launched ? 'opacity-0' : ''}`}
        >
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="Enter your username"
              autoFocus={!launched}
              autoComplete="username"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-status-error">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={loading || launched}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          {oauthProviders.length > 0 && (
            <>
              <div className="flex items-center gap-3 mt-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-text-tertiary">or continue with</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
                {oauthProviders.filter((p) => p.provider !== 'anthropic').map((p) => (
                  <a
                    key={p.provider}
                    href={`/api/auth/oauth/${p.provider}?returnTo=${encodeURIComponent(returnTo)}`}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    <OAuthIcon provider={p.provider} />
                    Sign in with {p.name}
                  </a>
                ))}
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
