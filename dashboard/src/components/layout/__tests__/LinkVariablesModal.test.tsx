import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../../api/roles', () => ({ useRoleDetails: vi.fn() }));
vi.mock('../../../api/escalations', () => ({
  useFacetValues: vi.fn(() => ({ data: { values: ['north', 'south'] } })),
}));

import { useAuth } from '../../../hooks/useAuth';
import { useRoleDetails } from '../../../api/roles';
import { LinkVariablesModal } from '../LinkVariablesModal';
import { getLinkVarValues, setLinkVarValue } from '../../../lib/link-vars';

const mockAuth = vi.mocked(useAuth);
const mockRoleDetails = vi.mocked(useRoleDetails);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockAuth.mockReturnValue({
    user: { userId: 'u1', roles: [{ role: 'gluer' }] },
    isSuperAdmin: false,
    hasRoleType: () => false,
  } as unknown as ReturnType<typeof useAuth>);
  mockRoleDetails.mockReturnValue({
    data: {
      roles: [{
        role: 'gluer',
        properties: {
          link_variables: [
            { name: 'facility', label: 'Facility', default: 'main' },
            { name: 'bench' },
          ],
        },
      }],
    },
  } as unknown as ReturnType<typeof useRoleDetails>);
});

describe('LinkVariablesModal', () => {
  it('renders one row per declared variable with default as placeholder', () => {
    render(<LinkVariablesModal open onClose={() => {}} />);
    const rows = screen.getAllByTestId('link-var-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByPlaceholderText('main (default)')).toBeTruthy();
    expect(screen.getByPlaceholderText('no filter')).toBeTruthy();
  });

  it('offers the facet\'s distinct values as datalist options', () => {
    render(<LinkVariablesModal open onClose={() => {}} />);
    const opts = Array.from(document.querySelectorAll('datalist option')).map((o) => (o as HTMLOptionElement).value);
    expect(opts).toContain('north');
    expect(opts).toContain('south');
  });

  it('typing sets the device binding live', () => {
    render(<LinkVariablesModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Value for facility'), { target: { value: 'soleful' } });
    expect(getLinkVarValues('u1')).toEqual({ facility: 'soleful' });
  });

  it('clear removes the binding', () => {
    setLinkVarValue('u1', 'facility', 'soleful');
    render(<LinkVariablesModal open onClose={() => {}} />);
    fireEvent.click(screen.getByTitle('Clear facility'));
    expect(getLinkVarValues('u1')).toEqual({});
  });

  it('renders nothing-declared copy when the union is empty', () => {
    mockRoleDetails.mockReturnValue({
      data: { roles: [{ role: 'gluer', properties: {} }] },
    } as unknown as ReturnType<typeof useRoleDetails>);
    render(<LinkVariablesModal open onClose={() => {}} />);
    expect(screen.getByText(/declare no link variables/)).toBeTruthy();
  });

  it('focuses the first value input on open', () => {
    render(<LinkVariablesModal open onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Value for facility'));
  });

  it('OK and Enter both confirm-and-close', () => {
    const onClose = vi.fn();
    render(<LinkVariablesModal open onClose={onClose} />);
    fireEvent.click(screen.getByText('OK'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('Value for facility'), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not render when closed', () => {
    render(<LinkVariablesModal open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('link-var-row')).toBeNull();
  });
});
