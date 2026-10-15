import { screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renderWithProviders } from '../../../test/render';

const status = { connected: false, unavailable: false };

vi.mock('../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, userRoleNames: [] }),
}));
vi.mock('../../../hooks/useNats', () => ({ useNatsStatus: () => status }));

import { apiFetch } from '../../../api/client';
import { AnnouncementBanner, LIVE_UPDATES_NOTICE } from '../AnnouncementBanner';

describe('AnnouncementBanner live updates notice', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockResolvedValue({ announcements: [] });
  });

  it('shows the notice while live updates are unavailable, with no dismiss control', async () => {
    status.unavailable = true;
    renderWithProviders(<AnnouncementBanner />);
    expect(await screen.findByText(LIVE_UPDATES_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('renders nothing when connected and there are no announcements', () => {
    status.unavailable = false;
    renderWithProviders(<AnnouncementBanner />);
    expect(screen.queryByTestId('announcement-banner')).not.toBeInTheDocument();
  });
});
