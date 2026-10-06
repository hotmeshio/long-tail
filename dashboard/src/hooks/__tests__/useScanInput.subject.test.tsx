import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// The bench motion through the pipeline: the bag's hold rides the next scan,
// a tub that needs a badge waits for it and replays as the badged person,
// and an open form's scan field takes a code before the server sees it.
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { userId: 'station-1' } }) }));
vi.mock('../useKioskMode', () => ({ useKioskMode: () => ({ role: 'binning-associate' }) }));
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

const render = () => renderHook(() => ({ scan: useScanInput(), acting: useActingIdentity() }), { wrapper });
const SUBJECT = { code: '11:0:K7Q2M9XA', escalationId: 'bag-row' };
const held = () => ({
  outcome: 'held' as const,
  subject: { ...SUBJECT, label: 'K7Q2M9XA', expiresAt: new Date(Date.now() + 45_000).toISOString() },
});
const primed = (token: string) => ({
  outcome: 'identity_primed' as const,
  actor: { id: 'maria', displayName: 'Maria' },
  actingToken: token,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  maxUses: 1,
});

beforeEach(() => execute.mockReset());

describe('useScanInput — the held subject', () => {
  it('a hold rides the next scan, and a placed answer lets it go', async () => {
    const { result } = render();
    execute.mockResolvedValueOnce(held());
    await act(() => result.current.scan.submitCode('11:0:K7Q2M9XA'));
    expect(result.current.scan.subject?.label).toBe('K7Q2M9XA');

    execute.mockResolvedValueOnce({ outcome: 'executed', verb: 'accumulate', clearSubject: true, escalation: { id: 'bin-row', role: 'bin', status: 'pending' } });
    await act(() => result.current.scan.submitCode('14:0:SF-A-2'));
    expect(execute).toHaveBeenLastCalledWith('14:0:SF-A-2', expect.objectContaining({ subject: SUBJECT }));
    expect(result.current.scan.subject).toBeNull();
    // The station answers the placement, so the scan reports as navigated (no toast).
    expect(result.current.scan.lastResult?.navigated).toBe(true);
  });

  it('every scan names the role the device is locked to, so a badge mints under its policy', async () => {
    const { result } = render();
    execute.mockResolvedValueOnce(primed('eph:v1:acting_identity:m'));
    await act(() => result.current.scan.submitCode('12:0:HB-MARIA'));
    expect(execute).toHaveBeenLastCalledWith('12:0:HB-MARIA', expect.objectContaining({ stationRole: 'binning-associate' }));
  });

  it('a refusal keeps the subject so the right container can be scanned next', async () => {
    const { result } = render();
    execute.mockResolvedValueOnce(held());
    await act(() => result.current.scan.submitCode('11:0:K7Q2M9XA'));
    execute.mockResolvedValueOnce({ outcome: 'refused', refusal: { markdown: 'This bag goes in SF-A-2.' } });
    await act(() => result.current.scan.submitCode('14:0:SF-B-9'));
    expect(result.current.scan.subject?.escalationId).toBe('bag-row');
  });
});

describe('useScanInput — a scan waiting on the badge', () => {
  it('bag, tub, badge: the tub replays once as the badged person', async () => {
    const { result } = render();
    execute.mockResolvedValueOnce(held());
    await act(() => result.current.scan.submitCode('11:0:K7Q2M9XA'));

    execute.mockResolvedValueOnce({ outcome: 'not_primed', replayable: true });
    await act(() => result.current.scan.submitCode('14:0:SF-A-2'));
    expect(result.current.scan.pendingScan?.code).toBe('14:0:SF-A-2');

    execute
      .mockResolvedValueOnce(primed('eph:v1:acting_identity:m'))
      .mockResolvedValueOnce({ outcome: 'executed', verb: 'accumulate', clearSubject: true });
    await act(() => result.current.scan.submitCode('12:0:HB-MARIA'));

    expect(execute).toHaveBeenLastCalledWith('14:0:SF-A-2', expect.objectContaining({
      actingToken: 'eph:v1:acting_identity:m', subject: SUBJECT,
    }));
    expect(result.current.scan.pendingScan).toBeNull();
    expect(result.current.scan.subject).toBeNull();
  });

  it('a different scan in between lets the waiting scan go', async () => {
    const { result } = render();
    execute.mockResolvedValueOnce({ outcome: 'not_primed', replayable: true });
    await act(() => result.current.scan.submitCode('14:1:SF-A-2'));
    execute.mockResolvedValueOnce(held());
    await act(() => result.current.scan.submitCode('11:0:K7Q2M9XA'));
    expect(result.current.scan.pendingScan).toBeNull();
  });
});

describe('useScanInput — interceptors', () => {
  it('the newest interceptor looks first; a consumed code never reaches the server', async () => {
    const { result } = render();
    const older = vi.fn(() => true);
    const newer = vi.fn((raw: string) => raw === '14:0:SF-A-2');
    act(() => { result.current.scan.pushCodeInterceptor(older); });
    let pop = () => {};
    act(() => { pop = result.current.scan.pushCodeInterceptor(newer); });

    await act(() => result.current.scan.submitCode('14:0:SF-A-2'));
    expect(newer).toHaveBeenCalled();
    expect(older).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    act(() => pop());
    await act(() => result.current.scan.submitCode('14:0:SF-A-2'));
    expect(older).toHaveBeenCalled();
  });
});
