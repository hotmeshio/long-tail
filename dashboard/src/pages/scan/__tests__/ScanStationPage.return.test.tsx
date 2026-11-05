import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ScanStationPage } from '../ScanStationPage';
import type { ScanExecuteResponse } from '../../../api/scan-codes';

// A read-only station over several benches returns by the role of the row an
// act completed, whether or not a station queue is chosen.
const NO_QUEUE = { kiosk: false, role: null, homePath: null };
const MATCHING_QUEUE = { kiosk: true, role: 'matching', homePath: '/escalations/available?role=matching&status=available' };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  lastResult: { current: null as unknown },
  subject: { current: null as unknown },
  kiosk: { current: null as unknown },
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
  useKioskMode: () => mocks.kiosk.current,
}));
vi.mock('../../../api/roles', () => ({
  useRoleDetails: () => ({
    data: {
      roles: [
        { role: 'receiving', properties: { kiosk: true, scan_done: { return: '/escalations/available?role=receiving&status=available', after_seconds: 2 } } },
        { role: 'matching', properties: { kiosk: true, scan_done: { return: 'home', after_seconds: 1 } } },
        { role: 'binning', properties: { kiosk: true, scan_done: { return: 'home', after_seconds: 1 } }, portals: [{ key: 'shelves', title: 'Shelves' }] },
      ],
    },
  }),
}));
vi.mock('../../../hooks/useEventContext', () => ({ useEventSubscriptions: () => {} }));
vi.mock('../../../hooks/useScanInput', () => ({
  SCAN_CHOICES_STATE: 'scanChoices',
  useScanInput: () => ({
    pushCodeInterceptor: () => () => {},
    lastResult: mocks.lastResult.current,
    subject: mocks.subject.current,
    dropSubject: vi.fn(),
    adoptResponse: vi.fn(),
    followCode: vi.fn(async () => false),
    pendingScan: null,
    dropPendingScan: vi.fn(),
  }),
}));
vi.mock('../../../api/scan-codes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/scan-codes')>()),
  executeScanChoice: vi.fn(),
}));
import { executeScanChoice } from '../../../api/scan-codes';
const executeMock = vi.mocked(executeScanChoice);

function completed(role: string, over: Partial<ScanExecuteResponse> = {}) {
  return {
    code: '17:0:SF-A-3', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true,
    response: {
      outcome: 'executed', verb: 'accumulate', clearSubject: true,
      escalation: { id: 'row-1', role, status: 'resolved' },
      done: { markdown: 'Binned.' },
      ...over,
    } as ScanExecuteResponse,
  };
}

const renderStation = (state?: Record<string, unknown>) => render(
  <MemoryRouter initialEntries={[{ pathname: '/scan/station', state: state ?? null }]}><ScanStationPage /></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.lastResult.current = null;
  mocks.subject.current = null;
  mocks.kiosk.current = NO_QUEUE;
});
afterEach(() => vi.useRealTimers());

describe('ScanStationPage — return by the completed row', () => {
  it('with no queue chosen, the completed row\'s role decides', async () => {
    mocks.lastResult.current = completed('receiving');
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_900); });
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(mocks.navigate).toHaveBeenCalledWith('/escalations/available?role=receiving&status=available');
  });

  it('a chosen queue\'s policy wins over the completed row\'s', async () => {
    mocks.kiosk.current = MATCHING_QUEUE;
    mocks.lastResult.current = completed('binning');
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(mocks.navigate).toHaveBeenCalledWith(MATCHING_QUEUE.homePath);
  });

  it('home with no queue chosen resolves to the completed role\'s station home', async () => {
    mocks.lastResult.current = completed('binning');
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(mocks.navigate).toHaveBeenCalledWith('/portal/binning/shelves');
  });

  it('a choice with done copy returns by its row\'s role', async () => {
    executeMock.mockResolvedValue({ outcome: 'executed', verb: 'resolve', escalation: { id: 'tub-1', role: 'receiving', status: 'resolved' }, done: { markdown: 'Arrived.' } });
    renderStation({ scanChoices: {
      outcome: 'choices', rule: { schemeVersion: 15, category: '1', name: 'Arrival' }, stepIndex: 0,
      escalation: { id: 'tub-1', role: 'receiving', status: 'pending' },
      choices: [{ index: 0, label: 'Arrive', verb: 'resolve', withheld: false }],
    } });
    fireEvent.click(screen.getByRole('button', { name: /Arrive/ }));
    await waitFor(() => expect(screen.getByTestId('done-panel')).toHaveTextContent('Arrived.'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(mocks.navigate).toHaveBeenCalledWith('/escalations/available?role=receiving&status=available');
  });

  it('an interim fill on a held subject never returns', async () => {
    mocks.subject.current = { code: '11:0:K7', escalationId: 'row-1', label: 'K7', expiresAt: new Date(Date.now() + 45_000).toISOString(), ttlMs: 45_000 };
    mocks.lastResult.current = completed('receiving', { clearSubject: false, progress: { filled: 1, total: 2, remaining: 1 } });
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('a refusal never returns', async () => {
    mocks.lastResult.current = { ...completed('receiving'), response: { outcome: 'refused', escalation: { id: 'row-1', role: 'receiving', status: 'pending' }, refusal: { markdown: 'Not this one.' } } };
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('a completed row whose role declares no policy stays on the done copy', async () => {
    mocks.lastResult.current = completed('inspection');
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByTestId('done-panel')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
