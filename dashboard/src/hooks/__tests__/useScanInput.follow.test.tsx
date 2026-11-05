import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Following a subject replays its code quietly: the answer lands on the
// station and never navigates, even when the rule's fallback names a route.
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { userId: 'station-1' } }) }));
vi.mock('../useKioskMode', () => ({ useKioskMode: () => ({ role: 'matching' }) }));
vi.mock('../../api/settings', () => ({ useSettings: () => ({ data: { features: { scanCodes: true } } }) }));
vi.mock('../../api/client', () => ({
  setActingTokenProvider: vi.fn(),
  setActingIdentityClear: vi.fn(),
  setActingIdentitySpent: vi.fn(),
}));
vi.mock('../../api/scan-codes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeScanCode: vi.fn(),
  useScanSchemes: () => ({ data: undefined }),
}));

import { executeScanCode } from '../../api/scan-codes';
import { ActingIdentityProvider } from '../useActingIdentity';
import { ScanInputProvider, useScanInput } from '../useScanInput';

const execute = vi.mocked(executeScanCode);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/scan/station']}>
      <ActingIdentityProvider><ScanInputProvider>{children}</ScanInputProvider></ActingIdentityProvider>
    </MemoryRouter>
  );
}

beforeEach(() => { execute.mockReset(); navigate.mockReset(); });

describe('useScanInput — following a subject', () => {
  it('a replay that finds nothing yet stays on the station, whatever the fallback route', async () => {
    const { result } = renderHook(() => useScanInput(), { wrapper });
    execute.mockResolvedValueOnce({ outcome: 'no_match_fallback', fallback: { markdown: 'Nothing yet.', route: '/somewhere' } });
    let held: boolean | undefined;
    await act(async () => { held = await result.current.followCode('11:0:K7Q2M9XA'); });
    expect(held).toBe(false);
    expect(execute).toHaveBeenLastCalledWith('11:0:K7Q2M9XA', expect.objectContaining({ stationRole: 'matching' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.lastResult?.navigated).toBe(true);
    expect(result.current.subject).toBeNull();
  });

  it('a replay that finds the next row holds it', async () => {
    const { result } = renderHook(() => useScanInput(), { wrapper });
    execute.mockResolvedValueOnce({
      outcome: 'held',
      subject: { code: '11:0:K7Q2M9XA', escalationId: 'bin-row', label: 'K7Q2M9XA', headline: 'SF-A-3', expiresAt: new Date(Date.now() + 45_000).toISOString() },
    });
    let held: boolean | undefined;
    await act(async () => { held = await result.current.followCode('11:0:K7Q2M9XA'); });
    expect(held).toBe(true);
    expect(result.current.subject?.headline).toBe('SF-A-3');
    expect(navigate).not.toHaveBeenCalled();
  });
});
