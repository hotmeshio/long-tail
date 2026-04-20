import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../api/client', () => ({
  getToken: vi.fn(),
}));

import { ListToolbar } from '../ListToolbar';
import { getToken } from '../../../../api/client';

let clipboardText = '';

beforeEach(() => {
  clipboardText = '';
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn((text: string) => { clipboardText = text; return Promise.resolve(); }) },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ListToolbar', () => {
  it('renders refresh button', () => {
    render(<ListToolbar onRefresh={vi.fn()} />);
    expect(screen.getByTitle('Refresh')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button clicked', () => {
    const onRefresh = vi.fn();
    render(<ListToolbar onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTitle('Refresh'));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('disables refresh when isFetching', () => {
    render(<ListToolbar onRefresh={vi.fn()} isFetching />);
    expect(screen.getByTitle('Refresh')).toBeDisabled();
  });

  it('hides URL and curl buttons when apiPath not provided', () => {
    render(<ListToolbar onRefresh={vi.fn()} />);
    expect(screen.queryByTitle('Copy API URL')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/curl/i)).not.toBeInTheDocument();
  });

  it('shows URL and curl buttons when apiPath provided', () => {
    render(<ListToolbar onRefresh={vi.fn()} apiPath="/test?limit=10" />);
    expect(screen.getByTitle('Copy API URL')).toBeInTheDocument();
    expect(screen.getByTitle('Copy curl (includes auth token)')).toBeInTheDocument();
  });

  it('copies full API URL to clipboard', async () => {
    render(<ListToolbar onRefresh={vi.fn()} apiPath="/workflow-states/jobs?limit=20" />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Copy API URL'));
    });
    expect(clipboardText).toBe('http://localhost:3000/api/workflow-states/jobs?limit=20');
  });

  it('copies curl with auth token when token exists', async () => {
    vi.mocked(getToken).mockReturnValue('my-jwt-token');
    render(<ListToolbar onRefresh={vi.fn()} apiPath="/test" />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Copy curl (includes auth token)'));
    });
    expect(clipboardText).toContain('curl -H "Authorization: Bearer my-jwt-token"');
    expect(clipboardText).toContain('/api/test');
  });

  it('copies curl without auth header when no token', async () => {
    vi.mocked(getToken).mockReturnValue(null);
    render(<ListToolbar onRefresh={vi.fn()} apiPath="/test" />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Copy curl (includes auth token)'));
    });
    expect(clipboardText).toBe('curl "http://localhost:3000/api/test"');
    expect(clipboardText).not.toContain('Authorization');
  });
});
