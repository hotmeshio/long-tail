import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ScanStationPage } from '../ScanStationPage';

// The bench motion on the station: holding an order, a refused container,
// and a scan waiting on the badge each take the screen.
const mocks = vi.hoisted(() => ({
  lastResult: { current: null as unknown },
  subject: { current: null as unknown },
  pendingScan: { current: null as unknown },
  identity: { current: null as unknown },
}));

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 'station-1', displayName: 'Binning' } }) }));
vi.mock('../../../hooks/useActingIdentity', () => ({
  useActingIdentity: () => ({ identity: mocks.identity.current, clear: vi.fn(), remainingSeconds: () => 0 }),
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

const SUBJECT = {
  code: '11:0:K7Q2M9XA', escalationId: 'bag-row', label: 'K7Q2M9XA', ttlMs: 45_000,
  expiresAt: new Date(Date.now() + 45_000).toISOString(),
  expect: { schemes: [14], prompt: 'Drop it in **SF-A-2** and scan the tub.' },
};

const renderStation = () => render(<MemoryRouter><ScanStationPage /></MemoryRouter>);

beforeEach(() => {
  mocks.lastResult.current = null;
  mocks.subject.current = null;
  mocks.pendingScan.current = null;
  mocks.identity.current = null;
});

describe('ScanStationPage — the bench', () => {
  it('holding an order shows it and asks for the container', () => {
    mocks.subject.current = SUBJECT;
    renderStation();
    expect(screen.getByTestId('hold-screen')).toBeInTheDocument();
    expect(screen.getByText('K7Q2M9XA')).toBeInTheDocument();
    expect(screen.getByText('SF-A-2')).toBeInTheDocument();
    expect(screen.getByText(/Scan your badge when you place it/)).toBeInTheDocument();
  });

  it('a refused container names the right one over the hold', () => {
    mocks.subject.current = SUBJECT;
    mocks.lastResult.current = {
      code: '14:0:SF-B-9', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true,
      response: { outcome: 'refused', refusal: { markdown: "That's Acme East's tub. This bag goes in **SF-A-2**.", expected: ['SF-A-2'] } },
    };
    renderStation();
    expect(screen.getByRole('alert')).toHaveTextContent("That's Acme East's tub. This bag goes in SF-A-2.");
    expect(screen.queryByTestId('hold-screen')).toBeNull();
  });

  it('a scan waiting on the badge asks for the badge', () => {
    mocks.subject.current = SUBJECT;
    mocks.subject.current = { ...SUBJECT, headline: 'SF-A-2' };
    mocks.pendingScan.current = { code: '14:0:SF-A-2', at: Date.now() };
    renderStation();
    expect(screen.getByText('Scan your badge to finish')).toBeInTheDocument();
    expect(screen.getByText('K7Q2M9XA → SF-A-2')).toBeInTheDocument();
  });

  it('a fill in progress shows how many are checked off', () => {
    mocks.subject.current = { ...SUBJECT, expect: undefined };
    mocks.lastResult.current = {
      code: '036000291452', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true,
      response: { outcome: 'executed', verb: 'fill', progress: { filled: 1, total: 3, remaining: 2 } },
    };
    renderStation();
    expect(screen.getByTestId('hold-progress')).toHaveTextContent('1 of 3 checked off');
  });

  it('with a headline the destination leads: bin code largest, place name under it, the item quieter above', () => {
    mocks.subject.current = { ...SUBJECT, headline: 'SF-A-2', subline: 'Acme East', expect: { schemes: [14], prompt: 'Walk to this bin and scan it.' } };
    renderStation();
    expect(screen.getByTestId('hold-headline')).toHaveTextContent('SF-A-2');
    expect(screen.getByTestId('hold-subline')).toHaveTextContent('Acme East');
    expect(screen.getByText('Walk to this bin and scan it.')).toBeInTheDocument();
    expect(screen.getByText('K7Q2M9XA')).toBeInTheDocument();
  });

  it('a placed item shows its done copy large until the next scan', () => {
    mocks.lastResult.current = {
      code: '14:0:SF-A-2', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true,
      response: { outcome: 'executed', verb: 'accumulate', clearSubject: true, done: { markdown: 'Drop it in **SF-A-2**. All good.' } },
    };
    renderStation();
    const panel = screen.getByTestId('done-panel');
    expect(panel).toHaveTextContent('Drop it in SF-A-2. All good.');
    expect(panel).toHaveTextContent('Scan the next item');
  });

  it('a rule without done copy still confirms; an item already in place says so', () => {
    mocks.lastResult.current = {
      code: '14:0:SF-A-2', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true,
      response: { outcome: 'executed', verb: 'accumulate', clearSubject: true, already: true },
    };
    renderStation();
    expect(screen.getByTestId('done-panel')).toHaveTextContent('Already there.');
  });

  it('a fill still in progress keeps the hold and shows the done copy as its progress line', () => {
    mocks.subject.current = { ...SUBJECT, expect: undefined };
    mocks.lastResult.current = {
      code: '036000291452', source: 'keyboard-wedge', at: Date.now(), error: null, navigated: true,
      response: { outcome: 'executed', verb: 'fill', progress: { filled: 1, total: 3, remaining: 2 }, done: { markdown: '1 of 3 shoes checked.' } },
    };
    renderStation();
    expect(screen.queryByTestId('done-panel')).toBeNull();
    expect(screen.getByTestId('hold-progress')).toHaveTextContent('1 of 3 shoes checked.');
  });

  it('with a badge live and nothing held, the station asks for the next item', () => {
    mocks.identity.current = { actingToken: 't', displayName: 'Maria', expiresAt: null };
    renderStation();
    expect(screen.getByText('Scan the next item')).toBeInTheDocument();
    expect(screen.getByText('Badged in as Maria')).toBeInTheDocument();
  });
});

