import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchModePicker } from '../SearchModePicker';
import type { ScanCommand, SearchMode } from '../../../lib/search-command';

const collect: ScanCommand = {
  version: 10, category: '1', name: 'Collect Print', schemeName: 'Printer serial',
  targetFacet: 'serialNumber', encoding: 'delimited', delimiter: ':', targetLength: null,
};
const locate: ScanCommand = { ...collect, version: 12, category: '0', name: 'Locate', schemeName: 'Asset tag', targetFacet: 'assetTag', encoding: 'fixed', targetLength: 8 };
const facets = ['escalationId', 'workflowId', 'po'];
const facetMode: SearchMode = { kind: 'facet', facet: 'po' };
const commandMode: SearchMode = { kind: 'command', command: collect };

function renderPicker(mode: SearchMode, extra: Partial<Parameters<typeof SearchModePicker>[0]> = {}) {
  const onSelect = vi.fn();
  render(<SearchModePicker mode={mode} facets={facets} commands={[collect, locate]} onSelect={onSelect} {...extra} />);
  return { onSelect };
}

describe('SearchModePicker', () => {
  it('the chip shows the facet in mono, a command in accent', () => {
    renderPicker(facetMode);
    const chip = screen.getByTestId('search-mode');
    expect(chip.textContent).toBe('po');
    expect(chip.querySelector('.font-mono')).toBeTruthy();
    expect(chip.title).toBe('Search by po');
  });

  it('a command chip carries the code recipe in its title', () => {
    renderPicker(commandMode);
    const chip = screen.getByTestId('search-mode');
    expect(chip.textContent).toBe('Collect Print');
    expect(chip.querySelector('.text-accent')).toBeTruthy();
    expect(chip.title).toBe('Printer serial · Collect Print — 10:1:<serialNumber>');
  });

  it('lists Find facets then Run commands grouped by scheme, with prefixes', () => {
    renderPicker(facetMode);
    fireEvent.click(screen.getByTestId('search-mode'));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      'escalationIdopens the item',
      'workflowIdopens the run',
      'pofilters the list',
      'Collect Print10:1:',
      'Locate120',
    ]);
    expect(screen.getByText('Run · Printer serial')).toBeTruthy();
    expect(screen.getByText('Run · Asset tag')).toBeTruthy();
    expect(screen.getByText('assetTag')).toBeTruthy();
  });

  it('marks the active mode and reports a pick, then closes', () => {
    const { onSelect } = renderPicker(facetMode);
    fireEvent.click(screen.getByTestId('search-mode'));
    expect(screen.getByRole('option', { name: /^po/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /Collect Print/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'command', command: collect });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the menu', () => {
    renderPicker(facetMode);
    fireEvent.click(screen.getByTestId('search-mode'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('offers the scan panel only when a handler is given', () => {
    const onOpenScanPanel = vi.fn();
    renderPicker(facetMode, { onOpenScanPanel });
    fireEvent.click(screen.getByTestId('search-mode'));
    fireEvent.click(screen.getByTestId('search-mode-scan-panel'));
    expect(onOpenScanPanel).toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hides the Find section when no facets are configured', () => {
    render(<SearchModePicker mode={commandMode} facets={[]} commands={[collect]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId('search-mode'));
    expect(screen.queryByText('Find')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});
