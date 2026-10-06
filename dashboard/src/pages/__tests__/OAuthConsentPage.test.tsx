import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: true, user: { userId: 'u1', displayName: 'Ada', username: 'ada' } },
  navigate: vi.fn(),
  client: { data: { client_id: 'ltc_1', client_name: 'Claude Code', redirect_uris: [] }, isError: false, isLoading: false },
  presets: { data: { presets: ['read_only', 'just_me'] } },
  mutate: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('react-router-dom', async (io) => ({ ...(await io<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));
vi.mock('../../components/common/display/AppLogo', () => ({ AppLogo: () => null }));
vi.mock('../../api/oauth-server', () => ({
  useOAuthClient: () => mocks.client,
  useGrantablePresets: () => mocks.presets,
  useConsentDecision: () => ({ mutate: mocks.mutate, isPending: false, isError: false, error: null }),
}));

import { OAuthConsentPage } from '../OAuthConsentPage';

const QUERY = '?client_id=ltc_1&redirect_uri=http%3A%2F%2F127.0.0.1%3A33418%2Fcb&code_challenge=abc&code_challenge_method=S256&response_type=code&state=s1';

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/oauth/consent${search}`]}>
      <OAuthConsentPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.isAuthenticated = true;
  mocks.client.isError = false;
  mocks.presets.data.presets = ['read_only', 'just_me'];
});

describe('OAuthConsentPage', () => {
  it('sends a signed-out visitor to login and back here', () => {
    mocks.auth.isAuthenticated = false;
    renderAt(QUERY);
    expect(mocks.navigate).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent(`/oauth/consent${QUERY}`)}`, { replace: true });
  });

  it('shows the facts: app, account and where it returns', () => {
    renderAt(QUERY);
    expect(screen.getByText('Connect Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:33418')).toBeInTheDocument();
  });

  it('offers only the presets the server allows, with Deny', () => {
    mocks.presets.data.presets = ['read_only'];
    renderAt(QUERY);
    expect(screen.getAllByRole('button', { name: 'Allow read-only' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Allow as me' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('sends the chosen preset with the request, or none to deny', () => {
    renderAt(QUERY);
    fireEvent.click(screen.getByRole('button', { name: 'Allow as me' }));
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      preset: 'just_me', request: { client_id: 'ltc_1', code_challenge: 'abc', state: 's1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(mocks.mutate.mock.calls[1][0].preset).toBeNull();
  });

  it('navigates to the redirect the server returns', () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign, host: 'lt.example' }, writable: true });
    mocks.mutate.mockImplementation((_d, opts) => opts.onSuccess({ redirect: 'http://127.0.0.1:33418/cb?code=c' }));
    renderAt(QUERY);
    fireEvent.click(screen.getByRole('button', { name: 'Allow read-only' }));
    expect(assign).toHaveBeenCalledWith('http://127.0.0.1:33418/cb?code=c');
  });

  it('shows the invalid-link message for a missing request or unknown client', () => {
    renderAt('?client_id=ltc_1');
    expect(screen.getByText('Sign-in link not valid')).toBeInTheDocument();
    mocks.client.isError = true;
    renderAt(QUERY);
    expect(screen.getAllByText('Sign-in link not valid')).toHaveLength(2);
  });
});
