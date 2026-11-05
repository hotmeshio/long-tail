import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ScanStationPage } from '../ScanStationPage';
import type { ScanExecuteResponse } from '../../../api/scan-codes';

// A scan session that finishes: done copy for a choice, the return to the
// station's list, and following the subject to its next row.
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  lastResult: { current: null as unknown },
  subject: { current: null as unknown },
  followCode: vi.fn(async () => {}),
  kiosk: { current: { role: 'matching', homePath: '/escalations/available?role=matching&status=available' } },
  roleDetails: { current: { roles: [] as unknown[] } },
  handlers: [] as Array<(event: unknown) => void>,
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 'station-1', displayName: 'Matching' } }) }));
vi.mock('../../../hooks/useActingIdentity', () => ({
  useActingIdentity: () => ({ identity: null, clear: vi.fn(), settle: vi.fn(), remainingSeconds: () => 0 }),
}));
vi.mock('../../../hooks/useKioskMode', () => ({ useKioskMode: () => mocks.kiosk.current }));
vi.mock('../../../api/roles', () => ({ useRoleDetails: () => ({ data: mocks.roleDetails.current }) }));
vi.mock('../../../hooks/useEventContext', () => ({
  useEventSubscriptions: (patterns: string[], handler: (event: unknown) => void) => {
    if (patterns.length) mocks.handlers.push(handler);
  },
}));
vi.mock('../../../hooks/useScanInput', () => ({
  SCAN_CHOICES_STATE: 'scanChoices',
  useScanInput: () => ({
    pushCodeInterceptor: () => () => {},
    lastResult: mocks.lastResult.current,
    subject: mocks.subject.current,
    dropSubject: vi.fn(),
    adoptResponse: vi.fn(),
    followCode: mocks.followCode,
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

const RETURNS = [{ role: 'matching', properties: { kiosk: true, scan_done: { return: 'home', after_seconds: 1 } } }];

function completingFill(over: Partial<ScanExecuteResponse> = {}) {
  return {
    code: '15:0:BOX-3', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true,
    response: {
      outcome: 'executed', verb: 'fill', clearSubject: true,
      escalation: { id: 'match-row', role: 'matching', status: 'resolved' },
      progress: { filled: 3, total: 3, remaining: 0 },
      done: { markdown: 'All three boxes in.' },
      ...over,
    } as ScanExecuteResponse,
  };
}

function choices(): ScanExecuteResponse {
  return {
    outcome: 'choices',
    rule: { schemeVersion: 10, category: '4', name: 'Tub' },
    stepIndex: 0,
    escalation: { id: 'tub-1', role: 'moving-tub', status: 'pending' },
    choices: [{ index: 0, label: 'Arrived: move the orders', verb: 'resolve', withheld: false }],
    notPrimed: { markdown: 'Badge please.' },
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
  mocks.roleDetails.current = { roles: [] };
  mocks.handlers.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('ScanStationPage — finishing', () => {
  it('a choice with done copy takes the screen as a done panel', async () => {
    executeMock.mockResolvedValue({ outcome: 'executed', verb: 'resolve', escalation: { id: 'tub-1', role: 'moving-tub', status: 'resolved' }, done: { markdown: 'Moved 12 orders to Matching.' } });
    renderStation({ scanChoices: choices() });
    fireEvent.click(screen.getByRole('button', { name: /Arrived/ }));
    await waitFor(() => expect(screen.getByTestId('done-panel')).toHaveTextContent('Moved 12 orders to Matching.'));
    expect(mocks.navigate).not.toHaveBeenCalledWith(expect.stringContaining('/escalations/'));
  });

  it('a completing fill returns to the station home after the pause, when the role says so', async () => {
    mocks.roleDetails.current = { roles: RETURNS };
    mocks.lastResult.current = completingFill();
    renderStation();
    expect(screen.getByTestId('done-panel')).toHaveTextContent('All three boxes in.');
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(mocks.navigate).toHaveBeenCalledWith('/escalations/available?role=matching&status=available');
  });

  it('without a return policy the done copy stays until the next scan', async () => {
    mocks.lastResult.current = completingFill();
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByTestId('done-panel')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('a refusal never returns', async () => {
    mocks.roleDetails.current = { roles: RETURNS };
    mocks.lastResult.current = { ...completingFill(), response: { outcome: 'refused', refusal: { markdown: 'Not this box.' } } as ScanExecuteResponse };
    renderStation();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('a follow waits for the next row, replays the held code when it is created, and holds off the return', async () => {
    mocks.roleDetails.current = { roles: RETURNS };
    const follow = { code: '11:0:K7Q2M9XA', roles: ['binning-associate'], waitSeconds: 10, target: { facet: 'orderId', value: 'K7Q2M9XA' } };
    mocks.lastResult.current = completingFill({ follow });
    renderStation();
    expect(screen.getByTestId('done-panel')).toHaveTextContent('Finding its next step');
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.handlers.length).toBeGreaterThan(0);
    act(() => mocks.handlers[0]({ data: { metadata: { orderId: 'OTHER' } } }));
    expect(mocks.followCode).not.toHaveBeenCalled();
    act(() => mocks.handlers[0]({ data: { metadata: { orderId: 'K7Q2M9XA' } } }));
    expect(mocks.followCode).toHaveBeenCalledWith('11:0:K7Q2M9XA');
  });

  it('a follow that finds nothing in time takes one last look, then returns', async () => {
    mocks.roleDetails.current = { roles: RETURNS };
    const follow = { code: '11:0:K7Q2M9XA', roles: ['binning-associate'], waitSeconds: 2, target: { facet: 'orderId', value: 'K7Q2M9XA' } };
    mocks.lastResult.current = completingFill({ follow });
    const view = renderStation();
    mocks.followCode.mockImplementationOnce(async () => {
      mocks.lastResult.current = { code: '11:0:K7Q2M9XA', source: 'follow', at: Date.now(), error: null, navigated: true, response: { outcome: 'no_match_fallback', fallback: {} } };
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(mocks.followCode).toHaveBeenCalledWith('11:0:K7Q2M9XA');
    view.rerender(<MemoryRouter initialEntries={[{ pathname: '/scan/station' }]}><ScanStationPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('done-panel')).toHaveTextContent('All three boxes in.'));
    expect(screen.getByTestId('done-panel')).toHaveTextContent('Scan the next item');
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(mocks.navigate).toHaveBeenCalledWith('/escalations/available?role=matching&status=available');
  });
});
