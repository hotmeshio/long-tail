import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

/**
 * Handles the OAuth callback by extracting the JWT token from the URL
 * query string (set by the backend OAuth callback redirect).
 * Strips the token from the URL immediately after consuming it.
 */
export function useOAuthCallback(): void {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (!token) return;

    // Consume the token — no stored credentials for OAuth (refresh is server-side)
    login(token);

    // Strip the token from the URL
    params.delete('token');
    const remaining = params.toString();
    const cleanPath = remaining
      ? `${location.pathname}?${remaining}`
      : location.pathname;
    navigate(cleanPath, { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps
}
