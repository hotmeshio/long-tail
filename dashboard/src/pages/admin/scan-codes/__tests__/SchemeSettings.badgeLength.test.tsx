import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const upsert = vi.hoisted(() => vi.fn());
vi.mock('../../../../api/scan-codes', async (io) => ({
  ...(await io<typeof import('../../../../api/scan-codes')>()),
  useUpsertScanScheme: () => ({ mutate: upsert, isPending: false, error: null }),
  useDeleteScanScheme: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

import { SchemeSettings } from '../SchemeSettings';

const scheme = (over: Record<string, unknown> = {}) => ({
  version: 14, name: 'Badge', description: null, target_facet: 'badge_id', encoding: 'delimited', delimiter: ':',
  target_length: null, patterns: [], precedes_gtin: null, target_match: 'value', kind: 'identity',
  grant_ttl_seconds: 300, grant_max_uses: 1, grant_scope: 'action', enabled: true, ...over,
}) as any;

const renderSettings = (s: any) => render(<MemoryRouter><SchemeSettings scheme={s} ruleCount={1} /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe('SchemeSettings badge length', () => {
  it('shows the default length of 10 for a delimited identity scheme and saves a new one', async () => {
    const u = userEvent.setup();
    renderSettings(scheme());
    const field = screen.getByLabelText(/Badge length/);
    expect(field).toHaveValue(10);
    await u.clear(field);
    await u.type(field, '12');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ version: 14, target_length: 12 }));
  });

  it('refuses a length outside 8 to 64', async () => {
    const u = userEvent.setup();
    renderSettings(scheme({ target_length: 10 }));
    const field = screen.getByLabelText(/Badge length/);
    await u.clear(field);
    await u.type(field, '6');
    expect(screen.getByText('Enter 8–64 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is not offered on action schemes', () => {
    renderSettings(scheme({ kind: 'action', target_facet: 'itemKey', grant_ttl_seconds: null, grant_max_uses: 0 }));
    expect(screen.queryByLabelText(/Badge length/)).toBeNull();
  });
});
