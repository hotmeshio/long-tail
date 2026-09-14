import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScanResult } from '../../../hooks/useScanInput';

const navigate = vi.fn();
const submitCode = vi.fn();
let lastResult: ScanResult | null = null;
let searchEnabled = true;

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../../api/settings', () => ({
  useSettings: () => ({ data: { search: { enabled: searchEnabled, facets: ['po'] } } }),
}));
vi.mock('../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useScanInput', () => ({
  useScanEnabled: () => true,
  useScanInput: () => ({ submitCode, busy: false, lastResult }),
}));
vi.mock('../../../hooks/useScanCommands', () => ({
  useScanCommands: () => ({
    commands: [
      { version: 10, category: '1', name: 'Collect Print', schemeName: 'Printer serial', targetFacet: 'serialNumber', encoding: 'delimited', delimiter: ':', targetLength: null },
      { version: 12, category: '0', name: 'Locate', schemeName: 'Asset tag', targetFacet: 'assetTag', encoding: 'fixed', delimiter: ':', targetLength: 8 },
    ],
    loading: false,
  }),
}));

import { SearchCommandBar } from '../SearchCommandBar';
import { SEARCH_MODE_KEY } from '../../../lib/search-command';

function renderBar(onOpenScanPanel?: () => void) {
  return render(<MemoryRouter><SearchCommandBar onOpenScanPanel={onOpenScanPanel} /></MemoryRouter>);
}

function pick(name: string) {
  fireEvent.click(screen.getByTestId('search-mode'));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${name}`) }));
}

function run(target: string) {
  fireEvent.change(screen.getByLabelText('Run target'), { target: { value: target } });
  fireEvent.keyDown(screen.getByLabelText('Run target'), { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  lastResult = null;
  searchEnabled = true;
});

describe('SearchCommandBar — Run modes', () => {
  it('a command shows its code head before the input and names the target', () => {
    renderBar();
    pick('Collect Print');
    expect(screen.getByTestId('search-command-prefix').textContent).toBe('10:1:');
    expect(screen.getByLabelText('Run target').getAttribute('placeholder')).toBe('serialNumber');
    expect(screen.getByTestId('search-mode').textContent).toBe('Collect Print');
  });

  it('Enter composes the code and executes it as a scan, then clears', () => {
    renderBar();
    pick('Collect Print');
    run('SN-9');
    expect(submitCode).toHaveBeenCalledWith('10:1:SN-9', 'toolbar');
    expect((screen.getByLabelText('Run target') as HTMLInputElement).value).toBe('');
  });

  it('a pasted whole code runs as-is, dashes normalized', () => {
    renderBar();
    pick('Collect Print');
    run('10:3:SN–9');
    expect(submitCode).toHaveBeenCalledWith('10:3:SN-9', 'toolbar');
  });

  it('a fixed scheme refuses a non-numeric target inline', () => {
    renderBar();
    pick('Locate');
    expect(screen.getByTestId('search-command-prefix').textContent).toBe('120');
    run('SN-9');
    expect(submitCode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Locate takes digits only');
  });

  it('pins the command on this device', () => {
    renderBar();
    pick('Locate');
    expect(JSON.parse(localStorage.getItem(SEARCH_MODE_KEY)!)).toEqual({ kind: 'command', version: 12, category: '0' });
  });

  it('a run that answered in place is narrated under the bar', () => {
    lastResult = {
      code: '10:1:SN-9', source: 'toolbar', at: 1, navigated: false, error: null,
      response: { outcome: 'no_match_fallback', rule: { schemeVersion: 10, category: '1', name: 'Collect Print' }, fallback: { markdown: '**No twin found.**' } },
    };
    renderBar();
    const note = screen.getByTestId('search-run-outcome');
    expect(note.textContent).toContain('No match — Collect Print');
    expect(note.textContent).toContain('No twin found.');
  });

  it('scanner-sourced results stay out of the bar', () => {
    lastResult = { code: '10:1:SN-9', source: 'keyboard-wedge', at: 1, navigated: false, error: null, response: { outcome: 'conflict' } };
    renderBar();
    expect(screen.queryByTestId('search-run-outcome')).toBeNull();
  });

  it('with search off, the bar is a pure command bar', () => {
    searchEnabled = false;
    renderBar();
    expect(screen.getByTestId('search-command-prefix').textContent).toBe('10:1:');
    fireEvent.click(screen.getByTestId('search-mode'));
    expect(screen.queryByText('Find')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('the menu footer opens the scan panel', () => {
    const onOpenScanPanel = vi.fn();
    renderBar(onOpenScanPanel);
    fireEvent.click(screen.getByTestId('search-mode'));
    fireEvent.click(screen.getByTestId('search-mode-scan-panel'));
    expect(onOpenScanPanel).toHaveBeenCalled();
  });
});
