import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertsSection } from '../AlertsSection';

const mockCreate = vi.fn();
const mockRemove = vi.fn();
let mockActive: Array<Record<string, unknown>> = [];

vi.mock('../../../api/announcements', () => ({
  useAnnouncements: () => ({ data: { announcements: mockActive } }),
  useCreateAnnouncement: () => ({ mutate: mockCreate, isPending: false, error: null }),
  useDeleteAnnouncement: () => ({ mutate: mockRemove, isPending: false }),
}));

vi.mock('../../../api/roles', () => ({
  useRoles: () => ({ data: { roles: ['reviewer', 'finisher'] } }),
}));

beforeEach(() => {
  mockCreate.mockReset();
  mockRemove.mockReset();
  mockActive = [];
});

describe('AlertsSection', () => {
  it('publishes title + summary with an expiry computed from the duration', () => {
    render(<AlertsSection />);
    fireEvent.change(screen.getByPlaceholderText('Optional headline'), {
      target: { value: 'Maintenance window' },
    });
    fireEvent.change(screen.getByPlaceholderText(/What everyone should know/), {
      target: { value: 'Printers pause at noon.' },
    });
    fireEvent.change(screen.getByLabelText('Visible for'), { target: { value: '240' } });
    fireEvent.click(screen.getByText('Publish alert'));

    expect(mockCreate).toHaveBeenCalledOnce();
    const [input] = mockCreate.mock.calls[0];
    expect(input.title).toBe('Maintenance window');
    expect(input.body).toBe('Printers pause at noon.');
    const expiresIn = new Date(input.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(239 * 60_000);
    expect(expiresIn).toBeLessThan(241 * 60_000);
  });

  it('targets selected roles through the standard pill control', () => {
    render(<AlertsSection />);
    fireEvent.change(screen.getByPlaceholderText(/What everyone should know/), {
      target: { value: 'Reviewer-only notice.' },
    });
    fireEvent.change(screen.getByLabelText('Add a role'), { target: { value: 'reviewer' } });
    fireEvent.click(screen.getByText('Publish alert'));

    const [input] = mockCreate.mock.calls[0];
    expect(input.roles).toEqual(['reviewer']);
  });

  it('untargeted alerts omit roles — everyone sees them', () => {
    render(<AlertsSection />);
    fireEvent.change(screen.getByPlaceholderText(/What everyone should know/), {
      target: { value: 'For all.' },
    });
    fireEvent.click(screen.getByText('Publish alert'));
    expect(mockCreate.mock.calls[0][0].roles).toBeUndefined();
    expect(screen.getByText('Everyone')).toBeInTheDocument();
  });

  it('requires a summary before publishing', () => {
    render(<AlertsSection />);
    expect(screen.getByText('Publish alert')).toBeDisabled();
  });

  it('lists active alerts and removes one for everyone', () => {
    mockActive = [
      {
        id: 'a1',
        title: 'Floor meeting',
        body: 'At 3pm.',
        layout: 'banner',
        roles: [],
        created_by: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ];
    render(<AlertsSection />);
    expect(screen.getByText('Floor meeting')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove Floor meeting'));
    expect(mockRemove).toHaveBeenCalledWith('a1');
  });
});
