import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockCapabilities = {
  categories: [
    {
      name: 'Data',
      tools: [
        {
          name: 'query_records',
          description: 'Query records by facet',
          inputSchema: { type: 'object', properties: {} },
          serverName: 'long-tail-records',
          serverId: 'srv-records',
        },
        {
          name: 'export_records',
          description: 'Export records to CSV',
          inputSchema: { type: 'object', properties: {} },
          serverName: 'long-tail-records',
          serverId: 'srv-records',
        },
      ],
    },
  ],
  totalTools: 2,
};

vi.mock('../../../api/capabilities', () => ({
  useCapabilities: () => ({ data: mockCapabilities, isLoading: false }),
}));

// The run panel itself is exercised elsewhere — stub it so the test focuses
// on the page's selection ↔ shell-panel contract.
vi.mock('../../../components/common/test/ToolTestPanel', () => ({
  ToolTestPanel: ({ tool, onClose }: { tool: { name: string }; onClose: () => void }) => (
    <div>
      <span>panel:{tool.name}</span>
      <button onClick={onClose}>close-run-panel</button>
    </div>
  ),
}));

// Shell panel mock — a mutable state so tests can simulate open/close.
const mockSetPanel = vi.fn();
const mockClosePanel = vi.fn();
let shellState: { open: boolean; ownerKey: string | null } = { open: false, ownerKey: null };
vi.mock('../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({ ...shellState, setPanel: mockSetPanel, closePanel: mockClosePanel }),
}));

import { CapabilitiesPage } from '../CapabilitiesPage';

// ── Helpers ──────────────────────────────────────────────────────────────────

function pageTree() {
  return (
    <MemoryRouter>
      <CapabilitiesPage />
    </MemoryRouter>
  );
}

function lastRunPanelCall() {
  const calls = mockSetPanel.mock.calls.filter(([, opts]) => opts?.key === 'capability-run');
  return calls[calls.length - 1];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CapabilitiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shellState = { open: false, ownerKey: null };
  });

  it('renders the list full-width with category sections', () => {
    const { container } = render(pageTree());
    expect(screen.getByRole('heading', { name: 'Capabilities' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByText('query_records')).toBeInTheDocument();
    expect(screen.getByText('export_records')).toBeInTheDocument();
    // The old reserved right column is gone — the list is the page.
    expect(container.querySelector('.grid-cols-3')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a capability')).not.toBeInTheDocument();
  });

  it('opens no run panel before a selection', () => {
    render(pageTree());
    expect(lastRunPanelCall()).toBeUndefined();
  });

  it('shows a trailing try-it icon per row, quiet until row hover', () => {
    render(pageTree());
    const icons = screen.getAllByTitle('Try it');
    expect(icons.length).toBe(2);
    for (const wrapper of icons) {
      const svg = wrapper.querySelector('svg');
      expect(svg?.getAttribute('class')).toContain('opacity-0');
      expect(svg?.getAttribute('class')).toContain('group-hover:opacity-100');
    }
  });

  it('opens the run panel in the shell when a tool row is clicked', () => {
    render(pageTree());
    fireEvent.click(screen.getByText('query_records'));
    const call = lastRunPanelCall();
    expect(call).toBeDefined();
    expect(call[1]).toEqual({ key: 'capability-run', width: 420 });
    render(call[0] as ReactElement);
    expect(screen.getByText('panel:query_records')).toBeInTheDocument();
  });

  it('marks the selected row and keeps its icon visible', () => {
    const { container } = render(pageTree());
    fireEvent.click(screen.getByText('query_records'));
    // Accent selection bar on the row.
    expect(container.querySelector('.bg-accent')).toBeInTheDocument();
    // Exact token match — the quiet rows carry group-hover:opacity-100 instead.
    const visible = screen
      .getAllByTitle('Try it')
      .filter((w) => w.querySelector('svg')?.getAttribute('class')?.split(' ').includes('opacity-100'));
    expect(visible.length).toBe(1);
  });

  it('clears the selection when the run panel closes via its X', () => {
    const { container } = render(pageTree());
    fireEvent.click(screen.getByText('query_records'));
    render(lastRunPanelCall()[0] as ReactElement);
    fireEvent.click(screen.getByText('close-run-panel'));
    expect(mockClosePanel).toHaveBeenCalledWith('capability-run');
    expect(container.querySelector('.bg-accent')).not.toBeInTheDocument();
  });

  it('clears the selection when the panel is closed externally', () => {
    const view = render(pageTree());
    fireEvent.click(screen.getByText('query_records'));
    // The shell reports our panel open…
    shellState = { open: true, ownerKey: 'capability-run' };
    view.rerender(pageTree());
    expect(mockClosePanel).not.toHaveBeenCalledWith('capability-run');
    // …then closed: the selection mark clears and the keyed slot is released.
    shellState = { open: false, ownerKey: null };
    view.rerender(pageTree());
    expect(mockClosePanel).toHaveBeenCalledWith('capability-run');
    expect(view.container.querySelector('.bg-accent')).not.toBeInTheDocument();
  });

  it('releases the panel slot on unmount', () => {
    const { unmount } = render(pageTree());
    fireEvent.click(screen.getByText('query_records'));
    unmount();
    expect(mockClosePanel).toHaveBeenCalledWith('capability-run');
  });
});
