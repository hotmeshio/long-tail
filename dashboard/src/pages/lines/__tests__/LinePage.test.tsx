import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { LineSummaryMachine, LineView, MachineView } from '../../../api/machines';
import { EventContext } from '../../../hooks/useEventContext';
import type { NatsEventHandler } from '../../../lib/nats/types';
import { machineViewStorageKey } from '../line-view-prefs';

const mocks = vi.hoisted(() => ({
  line: { data: undefined as LineView | undefined, isLoading: false, error: null },
  settings: { data: undefined as Record<string, unknown> | undefined },
  access: { isBuilder: false, isOps: true, canBulk: false },
  setPanel: vi.fn(),
  closePanel: vi.fn(),
}));

vi.mock('../../../api/machines', async (io) => ({
  ...(await io<typeof import('../../../api/machines')>()),
  useLine: () => mocks.line,
}));
vi.mock('../../../api/settings', () => ({ useSettings: () => mocks.settings }));
vi.mock('../../../hooks/useAccess', () => ({ useAccess: () => mocks.access }));
vi.mock('../../../hooks/useShellPanel', async (io) => ({
  ...(await io<typeof import('../../../hooks/useShellPanel')>()),
  useShellPanel: () => ({ setPanel: mocks.setPanel, closePanel: mocks.closePanel, open: false, ownerKey: null, node: null, width: 0 }),
}));

import { LinePage } from '../LinePage';

const SITE = 'site-1';
const LINE = 'line-1';

function machineView(machineId: string, process: string): MachineView {
  return {
    machineId, process, role: `line-${process}`, address: machineId, online: true, since: null, lastSeen: null,
    software: 'fw 1', bootId: null, sessionId: null, heldUnits: [],
    rows: { handoff: 0, command: 0, alarm: 0, offlineRowId: null, quietRowId: null }, alarms: [], jobs: [],
  };
}

function declare(count: number): LineSummaryMachine[] {
  return Array.from({ length: count }, (_, i) => ({
    machineId: `m-${i + 1}`, process: i % 2 ? 'press' : 'print', role: i % 2 ? 'line-press' : 'line-print', address: `m-${i + 1}`, addressing: 'declared' as const,
  }));
}

let handlers: Record<string, NatsEventHandler>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const subscribe = (pattern: string, handler: NatsEventHandler) => {
    handlers[pattern] = handler;
    return () => { delete handlers[pattern]; };
  };
  return (
    <QueryClientProvider client={qc}>
      <EventContext.Provider value={{ connected: true, subscribe }}>
        <MemoryRouter initialEntries={[`/lines/${SITE}/${LINE}`]}>
          <Routes>
            <Route path="/lines/:siteId/:lineId" element={children} />
          </Routes>
        </MemoryRouter>
      </EventContext.Provider>
    </QueryClientProvider>
  );
}

function setLine(count: number) {
  const machines = declare(count);
  mocks.settings.data = { machines: { declared: 1 } };
  mocks.line.data = {
    siteId: SITE, lineId: LINE, leading: true, takenAt: null, contested: [],
    machines: machines.map((m) => machineView(m.machineId, m.process)),
    summary: { siteId: SITE, lineId: LINE, machines },
  };
}

beforeEach(() => {
  localStorage.clear();
  handlers = {};
  mocks.setPanel.mockReset();
  setLine(3);
});

describe('LinePage', () => {
  it('selecting a machine opens its panel and follows it on the tape until released', () => {
    render(<LinePage />, { wrapper });
    fireEvent.click(screen.getByText('m-2'));
    expect(mocks.setPanel).toHaveBeenCalled();
    const chip = screen.getByRole('button', { name: /m-2 release/ });
    fireEvent.click(chip);
    expect(screen.queryByRole('button', { name: /m-2 release/ })).not.toBeInTheDocument();
  });


  it('picks the view by count and keeps an override per line', () => {
    setLine(20);
    const { unmount } = render(<LinePage />, { wrapper });
    expect(screen.getByLabelText('Machines region')).toHaveAttribute('data-view', 'rows');
    fireEvent.click(screen.getByRole('radio', { name: 'Tiles' }));
    expect(localStorage.getItem(machineViewStorageKey(SITE, LINE))).toBe('tiles');
    unmount();
    render(<LinePage />, { wrapper });
    expect(screen.getByLabelText('Machines region')).toHaveAttribute('data-view', 'tiles');
  });

  it('adds the line to the event stream once', () => {
    render(<LinePage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Watch on the event stream' }));
    expect(JSON.parse(localStorage.getItem('lt_event_feed_patterns') ?? '[]')).toContain(`lt.events.machine.wire.${SITE}.${LINE}.>`);
    expect(screen.getByRole('button', { name: 'Watching' })).toBeDisabled();
  });

  it('shows wire events on the tape as they arrive', () => {
    render(<LinePage />, { wrapper });
    act(() => {
      handlers[`lt.events.machine.wire.${SITE}.${LINE}.>`]({
        workflowId: '', workflowName: '', taskQueue: '',
        type: `machine.wire.${SITE}.${LINE}.m-1.in`, source: 'machine-gateway', timestamp: '2026-10-31T10:00:00.000Z',
        data: { type: 'machine.wire', siteId: SITE, lineId: LINE, machineId: 'm-1', address: 'm-1', direction: 'in', channel: 'job', topic: 't', id: '1', at: '2026-10-31T10:00:00.000Z', retained: false, kind: 'job', event: 'arrived', summary: 'job arrived U9', violations: [], actions: [] },
      });
    });
    expect(screen.getByText('job arrived U9')).toBeInTheDocument();
  });
});
