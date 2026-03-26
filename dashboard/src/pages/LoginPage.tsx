import { useState, useEffect, type FormEvent } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AppLogo } from '../components/common/display/AppLogo';
import { OAuthIcon } from '../components/common/OAuthIcon';
import { fetchOAuthProviders, type OAuthProvider } from '../api/oauth';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // After re-login, return to the page the user was on
  const returnTo = (location.state as { from?: string })?.from ?? '/';

  // Check for OAuth error in URL
  const oauthError = new URLSearchParams(location.search).get('error');

  // Fetch available OAuth providers on mount
  useEffect(() => {
    fetchOAuthProviders()
      .then(setOauthProviders)
      .catch(() => {}); // Silent — password login always works
  }, []);

  // Show OAuth error from callback redirect
  useEffect(() => {
    if (oauthError) setError(oauthError);
  }, [oauthError]);

  // Skip the instant redirect while the launch animation is playing
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

      // Launch the comet, then navigate after animation
      setLaunched(true);
      login(
        data.token,
        { username: username.trim(), password },
        { displayName: data.user?.display_name, username: data.user?.external_id },
      );
      setTimeout(() => navigate(returnTo, { replace: true }), 1500);
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
              autoFocus
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
                {oauthProviders.map((p) => (
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
