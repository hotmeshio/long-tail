import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ScanStationPage } from '../ScanStationPage';
import type { ScanExecuteResponse } from '../../../api/scan-codes';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  identity: { current: null as { actingToken: string; displayName: string; expiresAt: string | null } | null },
  clear: vi.fn(),
  settle: vi.fn(),
  lastResult: { current: null as unknown },
  subject: { current: null as unknown },
  pendingScan: { current: null as unknown },
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'user-1', username: 'station1', displayName: 'Station One' } }),
}));
vi.mock('../../../hooks/useActingIdentity', () => ({
  useActingIdentity: () => ({
    identity: mocks.identity.current,
    prime: vi.fn(),
    clear: mocks.clear,
    settle: mocks.settle,
    remainingSeconds: () => 0,
  }),
}));
vi.mock('../../../hooks/useScanInput', () => ({
  SCAN_CHOICES_STATE: 'scanChoices',
  useScanInput: () => ({
    pushCodeInterceptor: () => () => {},
    lastResult: mocks.lastResult.current,
    subject: mocks.subject.current,
    dropSubject: vi.fn(),
    adoptResponse: vi.fn(),
    pendingScan: mocks.pendingScan.current,
    dropPendingScan: vi.fn(),
  }),
}));
vi.mock('../../../api/scan-codes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/scan-codes')>()),
  executeScanChoice: vi.fn(),
}));
import { executeScanChoice } from '../../../api/scan-codes';
const executeMock = vi.mocked(executeScanChoice);

function choicesResponse(overrides?: Partial<ScanExecuteResponse>): ScanExecuteResponse {
  return {
    outcome: 'choices',
    rule: { schemeVersion: 10, category: '4', name: 'Order lifecycle' },
    stepIndex: 0,
    escalation: { id: 'esc-1', role: 'packing', status: 'pending' },
    choices: [
      { index: 0, label: 'Collected', verb: 'resolve', withheld: false },
      { index: 1, label: 'Claim & Work', verb: 'claim', withheld: false },
      { index: 2, label: 'Ship it', verb: 'escalate', requireActingIdentity: true, withheld: true },
    ],
    notPrimed: { markdown: 'Badge please.' },
    ...overrides,
  };
}

function autoSelectResponse(): ScanExecuteResponse {
  return choicesResponse({
    autoSelect: true,
    choices: [
      { index: 0, label: 'Claim & Work', verb: 'claim-show-detail', requireActingIdentity: true, withheld: true },
    ],
  });
}

function renderStation(response: ScanExecuteResponse) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/scan/station', state: { scanChoices: response } }]}>
      <ScanStationPage />
    </MemoryRouter>,
  );
}

/** Re-render the same tree so the mocked identity change is observed. */
function reRender(view: ReturnType<typeof render>) {
  view.rerender(
    <MemoryRouter initialEntries={[{ pathname: '/scan/station' }]}>
      <ScanStationPage />
    </MemoryRouter>,
  );
}

describe('ScanStationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.current = null;
  });

  it('a claim choice executed lands on the escalation detail page', async () => {
    executeMock.mockResolvedValue({ outcome: 'executed', verb: 'claim', escalation: { id: 'esc-1', role: 'packing', status: 'pending' } });
    renderStation(choicesResponse());
    fireEvent.click(screen.getByRole('button', { name: /Claim & Work/ }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/escalations/detail/esc-1'));
  });

  it('a claim choice hands the server\'s word on the badge to the identity, so a spent badge retires', async () => {
    mocks.identity.current = { actingToken: 'eph:v1:acting_identity:m', displayName: 'Maria', expiresAt: null };
    const result = {
      outcome: 'executed' as const, verb: 'claim' as const,
      escalation: { id: 'esc-1', role: 'packing', status: 'pending' },
      acting: { consumed: true, remaining: 0, bound: false },
    };
    executeMock.mockResolvedValue(result);
    renderStation(choicesResponse());
    fireEvent.click(screen.getByRole('button', { name: /Claim & Work/ }));
    await waitFor(() => expect(mocks.settle).toHaveBeenCalledWith('eph:v1:acting_identity:m', result));
  });

  it('a resolve choice executed returns to idle with a done notice', async () => {
    executeMock.mockResolvedValue({ outcome: 'executed', verb: 'resolve', escalation: { id: 'esc-1', role: 'packing', status: 'resolved' } });
    renderStation(choicesResponse());
    fireEvent.click(screen.getByRole('button', { name: /Collected/ }));
    await waitFor(() => expect(screen.getByText('Collected — done')).toBeInTheDocument());
    expect(screen.getByText('Scan your badge to begin')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalledWith(expect.stringContaining('/escalations/detail/'));
  });

  it('tapping a withheld choice opens the badge stop-over holding that choice', () => {
    renderStation(choicesResponse());
    fireEvent.click(screen.getByRole('button', { name: /Ship it/ }));
    expect(screen.getByText('Scan your badge to continue')).toBeInTheDocument();
    expect(screen.getByText('to Ship it')).toBeInTheDocument();
    expect(screen.getByText('Badge please.')).toBeInTheDocument();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('cancel from a withheld-tap stop-over returns to the choice screen', () => {
    renderStation(choicesResponse());
    fireEvent.click(screen.getByRole('button', { name: /Ship it/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Collected/ })).toBeInTheDocument();
  });

  it('an autoSelect response skips the choices and goes straight to the stop-over', () => {
    renderStation(autoSelectResponse());
    expect(screen.getByText('Scan your badge to continue')).toBeInTheDocument();
    expect(screen.getByText('to Claim & Work')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Claim & Work/ })).not.toBeInTheDocument();
  });

  it('cancel from an autoSelect stop-over returns to idle', () => {
    renderStation(autoSelectResponse());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Scan your badge to begin')).toBeInTheDocument();
  });

  it('priming while the stop-over is up auto-executes the pending choice and navigates', async () => {
    executeMock.mockResolvedValue({ outcome: 'executed', verb: 'claim-show-detail', escalation: { id: 'esc-1', role: 'packing', status: 'pending' } });
    const view = renderStation(autoSelectResponse());
    expect(executeMock).not.toHaveBeenCalled();

    mocks.identity.current = { actingToken: 'eph:v1:acting_identity:a', displayName: 'Dana', expiresAt: null };
    reRender(view);
    await waitFor(() => expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      escalationId: 'esc-1',
      choiceIndex: 0,
      actingToken: 'eph:v1:acting_identity:a',
    })));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/escalations/detail/esc-1'));
  });

  it('a not_primed answer clears the dead grant and parks the choice in the stop-over', async () => {
    executeMock.mockResolvedValue({ outcome: 'not_primed', notPrimed: { markdown: 'Badge please.' } });
    renderStation(choicesResponse());
    fireEvent.click(screen.getByRole('button', { name: /Collected/ }));
    await waitFor(() => expect(screen.getByText('Scan your badge to continue')).toBeInTheDocument());
    expect(screen.getByText('to Collected')).toBeInTheDocument();
    expect(mocks.clear).toHaveBeenCalled();
  });
});
