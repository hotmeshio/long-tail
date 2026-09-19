import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// A scan that carried an acting token and came back not_primed means the
// server found the grant dead. The provider must drop its copy, or every
// following scan repeats the badge screen until the TTL lapses.
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { userId: 'station-1' } }) }));
vi.mock('../../api/settings', () => ({ useSettings: () => ({ data: { features: { scanCodes: true } } }) }));
vi.mock('../../api/client', () => ({
  setActingTokenProvider: vi.fn(),
  setActingIdentityClear: vi.fn(),
  setActingIdentitySpent: vi.fn(),
}));
vi.mock('../../api/scan-codes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeScanCode: vi.fn(),
}));

import { executeScanCode } from '../../api/scan-codes';
import { ActingIdentityProvider, useActingIdentity } from '../useActingIdentity';
import { ScanInputProvider, useScanInput } from '../useScanInput';

const execute = vi.mocked(executeScanCode);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ActingIdentityProvider>
        <ScanInputProvider>{children}</ScanInputProvider>
      </ActingIdentityProvider>
    </MemoryRouter>
  );
}

const primed = (token: string) => ({
  outcome: 'identity_primed' as const,
  actor: { id: 'u-dana', displayName: 'Dana' },
  actingToken: token,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  maxUses: 0,
});

beforeEach(() => execute.mockReset());

describe('useScanInput — dead grant self-heal', () => {
  it('clears the identity when a scan that carried the token answers not_primed', async () => {
    const { result } = renderHook(() => ({ scan: useScanInput(), acting: useActingIdentity() }), { wrapper });
    execute.mockResolvedValueOnce(primed('eph:v1:acting_identity:dead'));
    await act(() => result.current.scan.submitCode('12:0:BADGE'));
    expect(result.current.acting.identity?.displayName).toBe('Dana');

    execute.mockResolvedValueOnce({ outcome: 'not_primed', error: 'acting identity expired' });
    await act(() => result.current.scan.submitCode('10:3:ORD-9'));
    expect(execute).toHaveBeenLastCalledWith('10:3:ORD-9', expect.objectContaining({ actingToken: 'eph:v1:acting_identity:dead' }));
    expect(result.current.acting.identity).toBeNull();

    // the next scan runs unprimed
    execute.mockResolvedValueOnce({ outcome: 'choices', choices: [] });
    await act(() => result.current.scan.submitCode('10:3:ORD-9'));
    expect(execute.mock.calls[2][1]).toEqual({});
  });

  it('leaves the identity alone when not_primed answers an unprimed scan', async () => {
    const { result } = renderHook(() => ({ scan: useScanInput(), acting: useActingIdentity() }), { wrapper });
    execute.mockResolvedValueOnce({ outcome: 'not_primed' });
    await act(() => result.current.scan.submitCode('10:3:ORD-9'));
    expect(result.current.acting.identity).toBeNull();
    expect(result.current.scan.lastResult?.response?.outcome).toBe('not_primed');
  });
});
