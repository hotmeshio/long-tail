import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ScanStationPage } from '../ScanStationPage';
import type { ScanExecuteResponse } from '../../../api/scan-codes';

// One contract on every station: the answer offers Open into its target, a
// done screen counts down and offers a way back now, and a hold's release
// reads and returns as the rule names it.
const DOCK = { kiosk: true, role: 'docking', homePath: '/escalations/available?role=docking&status=available' };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  dropSubject: vi.fn(),
  claim: vi.fn(async () => ({})),
  lastResult: { current: null as unknown },
  subject: { current: null as unknown },
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 'station-1', displayName: 'Floor' } }) }));
vi.mock('../../../hooks/useActingIdentity', () => ({
  useActingIdentity: () => ({ identity: null, clear: vi.fn(), settle: vi.fn(), remainingSeconds: () => 0 }),
}));
vi.mock('../../../hooks/useKioskMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useKioskMode')>()),
  useKioskMode: () => DOCK,
}));
vi.mock('../../../api/roles', () => ({
  useRoleDetails: () => ({
    data: { roles: [{ role: 'docking', properties: { kiosk: true, scan_done: { return: 'home', after_seconds: 2, button: 'Done' } } }] },
  }),
}));
vi.mock('../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/escalations')>()),
  useClaimEscalation: () => ({ mutateAsync: mocks.claim }),
}));
vi.mock('../../../hooks/useEventContext', () => ({ useEventSubscriptions: () => {} }));
vi.mock('../../../hooks/useScanInput', () => ({
  SCAN_CHOICES_STATE: 'scanChoices',
  useScanInput: () => ({
    pushCodeInterceptor: () => () => {},
    lastResult: mocks.lastResult.current,
    subject: mocks.subject.current,
    dropSubject: mocks.dropSubject,
    adoptResponse: vi.fn(),
    followCode: vi.fn(async () => false),
    pendingScan: null,
    dropPendingScan: vi.fn(),
  }),
}));

function bench(response: Partial<ScanExecuteResponse>) {
  return { code: '12:0:P1', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true, response: response as ScanExecuteResponse };
}

const renderStation = () => render(<MemoryRouter initialEntries={['/scan/station']}><ScanStationPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.lastResult.current = null;
  mocks.subject.current = null;
});
afterEach(() => vi.useRealTimers());

describe('ScanStationPage: the done screen', () => {
  it('waits the act\'s own pause, counts it down, and names what comes next', async () => {
    mocks.lastResult.current = bench({
      outcome: 'executed', verb: 'fill', clearSubject: true,
      escalation: { id: 'row-1', role: 'docking', status: 'resolved' },
      done: { markdown: 'Received.', afterSeconds: 5, nextPrompt: 'Set the parcel on the cart' },
    });
    renderStation();
    expect(screen.getByText('Set the parcel on the cart')).toBeTruthy();
    expect(screen.getByTestId('done-countdown').textContent).toBe('Returning in 5s');
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(mocks.navigate).toHaveBeenCalledWith(DOCK.homePath);
  });

  it('the role\'s button returns at once', () => {
    mocks.lastResult.current = bench({
      outcome: 'executed', verb: 'fill', clearSubject: true,
      escalation: { id: 'row-1', role: 'docking', status: 'resolved' }, done: { markdown: 'Received.' },
    });
    renderStation();
    fireEvent.click(screen.getByTestId('done-return'));
    expect(screen.getByTestId('done-return').textContent).toBe('Done');
    expect(mocks.navigate).toHaveBeenCalledWith(DOCK.homePath);
  });

  it('offers Open into the list the act names', () => {
    mocks.lastResult.current = bench({
      outcome: 'executed', verb: 'accumulate', clearSubject: true,
      escalation: { id: 'row-1', role: 'docking', status: 'resolved' }, done: { markdown: 'Binned.' },
      open: { label: 'Open the bin', facets: { binCode: 'B-7' } },
    });
    renderStation();
    fireEvent.click(screen.getByRole('button', { name: 'Open the bin' }));
    return waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('/escalations/available?facets=')));
  });
});

describe('ScanStationPage: refusals and holds', () => {
  it('a refusal opens the row it names', async () => {
    mocks.lastResult.current = bench({ outcome: 'refused', refusal: { markdown: 'This bag is at Matching.' }, open: { label: 'Open', escalationId: 'bag-row' } });
    renderStation();
    fireEvent.click(screen.getByTestId('scan-open'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/escalations/detail/bag-row'));
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('a hold\'s Open claims as the person acting, lets go of the item, and opens the row', async () => {
    mocks.subject.current = {
      code: '15:0:T-1', escalationId: 'tub-row', label: 'T-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), ttlMs: 60_000,
      open: { label: 'Open', escalationId: 'tub-row', claim: true },
    };
    renderStation();
    fireEvent.click(screen.getByTestId('scan-open'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/escalations/detail/tub-row'));
    expect(mocks.claim).toHaveBeenCalledWith({ id: 'tub-row', durationMinutes: 30 });
    expect(mocks.dropSubject).toHaveBeenCalled();
  });

  it('a refused claim still opens the row, read-only', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('403'));
    mocks.subject.current = {
      code: '15:0:T-1', escalationId: 'tub-row', label: 'T-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), ttlMs: 60_000,
      open: { label: 'Open', escalationId: 'tub-row', claim: true },
    };
    renderStation();
    fireEvent.click(screen.getByTestId('scan-open'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/escalations/detail/tub-row'));
  });

  it('the hold\'s release reads as the rule names it and returns home', () => {
    mocks.subject.current = {
      code: '15:0:T-1', escalationId: 'tub-row', label: 'T-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), ttlMs: 60_000,
      release: { label: "I'm done", tone: 'accent', return: 'home' },
    };
    renderStation();
    const release = screen.getByTestId('hold-release');
    expect(release.textContent).toBe("I'm done");
    expect(release.className).toContain('btn-primary');
    fireEvent.click(release);
    expect(mocks.dropSubject).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith(DOCK.homePath);
  });

  it('without a release declared, the hold puts the item down and stays', () => {
    mocks.subject.current = { code: '15:0:T-1', escalationId: 'tub-row', label: 'T-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), ttlMs: 60_000 };
    renderStation();
    fireEvent.click(screen.getByText('Put it down'));
    expect(mocks.dropSubject).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
