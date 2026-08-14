import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../../test/render';
import { EventContext } from '../../../hooks/useEventContext';
import type { Announcement } from '../../../api/announcements';
import type { NatsEventHandler } from '../../../lib/nats/types';

vi.mock('../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, userRoleNames: ['finisher'] }),
}));

import { apiFetch } from '../../../api/client';
import { AnnouncementBanner } from '../AnnouncementBanner';
import { ANNOUNCEMENT_SUBJECT } from '../../../api/announcements';

const apiFetchMock = vi.mocked(apiFetch);

const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString();

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'ann-1',
    title: 'Maintenance tonight',
    body: 'The system goes **offline** at 22:00.',
    layout: 'banner',
    roles: [],
    created_by: 'admin-1',
    created_at: new Date().toISOString(),
    expires_at: IN_AN_HOUR,
    ...overrides,
  };
}

function mockList(announcements: Announcement[]) {
  apiFetchMock.mockResolvedValue({ announcements });
}

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    localStorage.clear();
  });

  it('renders the notice line and expands to the markdown body', async () => {
    mockList([announcement()]);
    renderWithProviders(<AnnouncementBanner />);

    const headline = await screen.findByText('Maintenance tonight');
    expect(screen.queryByText(/goes/)).not.toBeInTheDocument();

    fireEvent.click(headline);
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('escapes author HTML — a script-bearing body renders as text, not markup', async () => {
    mockList([announcement({ title: 'Injected', body: '<img src=x onerror=alert(1)> hi' })]);
    const { container } = renderWithProviders(<AnnouncementBanner />);
    fireEvent.click(await screen.findByText('Injected'));
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(/onerror=alert/)).toBeInTheDocument();
  });

  it('dismiss hides the notice and persists across remounts', async () => {
    mockList([announcement()]);
    const first = renderWithProviders(<AnnouncementBanner />);
    fireEvent.click(await first.findByLabelText('Dismiss Maintenance tonight'));
    expect(screen.queryByText('Maintenance tonight')).not.toBeInTheDocument();

    first.unmount();
    renderWithProviders(<AnnouncementBanner />);
    expect(screen.queryByText('Maintenance tonight')).not.toBeInTheDocument();
  });

  it('re-filters live rows by the viewer roles and expiry', async () => {
    mockList([
      announcement({ id: 'mine', title: 'For finishers', roles: ['finisher'] }),
      announcement({ id: 'other', title: 'For shippers', roles: ['shipper'] }),
      announcement({ id: 'stale', title: 'Old news', expires_at: new Date(Date.now() - 1000).toISOString() }),
    ]);
    renderWithProviders(<AnnouncementBanner />);

    expect(await screen.findByText('For finishers')).toBeInTheDocument();
    expect(screen.queryByText('For shippers')).not.toBeInTheDocument();
    expect(screen.queryByText('Old news')).not.toBeInTheDocument();
  });

  it('renders nothing when there are no visible notices', async () => {
    mockList([]);
    const { container } = renderWithProviders(<AnnouncementBanner />);
    await Promise.resolve();
    expect(container.querySelector('[data-testid="announcement-banner"]')).toBeNull();
  });

  it('subscribes on the prefixed wire subject and refetches on the live event', async () => {
    mockList([]);
    const subscriptions = new Map<string, NatsEventHandler>();
    const subscribe = vi.fn((pattern: string, handler: NatsEventHandler) => {
      subscriptions.set(pattern, handler);
      return () => subscriptions.delete(pattern);
    });

    renderWithProviders(
      <EventContext.Provider value={{ connected: true, subscribe }}>
        <AnnouncementBanner />
      </EventContext.Provider>,
    );

    // The wire carries lt.events.{type} — a bare topic pattern never matches.
    expect(subscribe).toHaveBeenCalledWith('lt.events.system.surfaces.dashboard', expect.any(Function));
    expect(ANNOUNCEMENT_SUBJECT).toBe('lt.events.system.surfaces.dashboard');

    // Let the initial (empty) fetch settle, then push the live event.
    await act(async () => {});

    // A published announcement arrives over the socket → the banner refetches
    // and renders without any reload.
    mockList([announcement({ title: 'Fresh notice' })]);
    await act(async () => {
      subscriptions.get(ANNOUNCEMENT_SUBJECT)!({ type: 'system.surfaces.dashboard' } as any);
    });
    await waitFor(() => expect(screen.getByText('Fresh notice')).toBeInTheDocument());
  });

  it('drops a notice the moment it expires — no reload needed', async () => {
    vi.useFakeTimers();
    try {
      mockList([announcement({ title: 'Short lived', expires_at: new Date(Date.now() + 2_000).toISOString() })]);
      renderWithProviders(<AnnouncementBanner />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByText('Short lived')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      expect(screen.queryByText('Short lived')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
