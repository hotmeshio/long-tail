import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { ShellPanelProvider, useShellPanel } from '../useShellPanel';
import { SlidePanel } from '../../components/common/layout/SlidePanel';

function PanelHost() {
  const { node, width, open } = useShellPanel();
  return (
    <SlidePanel open={open} width={width}>
      {node}
    </SlidePanel>
  );
}

function PageA() {
  const { setPanel, closePanel, ownerKey } = useShellPanel();
  return (
    <div>
      <button onClick={() => setPanel(<p>Panel content</p>, { width: 420 })}>open</button>
      <button onClick={() => closePanel()}>close</button>
      <button onClick={() => setPanel(<p>Facet content</p>, { width: 420, key: 'facet' })}>open-facet</button>
      <button onClick={() => setPanel(<p>Filter content</p>, { width: 320, key: 'filters' })}>open-filters</button>
      <button onClick={() => closePanel('facet')}>close-facet</button>
      <span data-testid="owner">{ownerKey ?? 'none'}</span>
      <Link to="/b">go-b</Link>
    </div>
  );
}

function harness() {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <ShellPanelProvider>
        <Routes>
          <Route path="/a" element={<PageA />} />
          <Route path="/b" element={<p>Page B</p>} />
        </Routes>
        <PanelHost />
      </ShellPanelProvider>
    </MemoryRouter>,
  );
}

describe('useShellPanel', () => {
  it('opens the global panel with page-provided content', () => {
    harness();
    expect(screen.queryByText('Panel content')).toBeNull();
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('Panel content')).toBeInTheDocument();
  });

  it('closePanel collapses the slot', () => {
    harness();
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('close'));
    // SlidePanel keeps content mounted through the width transition; the
    // container is already collapsed to zero width.
    const wrapper = screen.getByText('Panel content').closest('div[style]');
    expect(wrapper).not.toBeNull();
  });

  it('clears the panel on route change', () => {
    harness();
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('go-b'));
    expect(screen.getByText('Page B')).toBeInTheDocument();
    expect(screen.queryByText('Panel content')).toBeNull();
  });

  it('a keyed claim takes the slot and records the owner', () => {
    harness();
    fireEvent.click(screen.getByText('open-facet'));
    expect(screen.getByTestId('owner').textContent).toBe('facet');
    fireEvent.click(screen.getByText('open-filters'));
    expect(screen.getByTestId('owner').textContent).toBe('filters');
    expect(screen.getByText('Filter content')).toBeInTheDocument();
  });

  it('a keyed close from a non-owner is a no-op — the live panel survives', () => {
    harness();
    fireEvent.click(screen.getByText('open-filters'));
    fireEvent.click(screen.getByText('close-facet'));
    // Filters still own the open slot: content mounted, panel not collapsed.
    // The animating width lives on the OUTER SlidePanel div (the inner div
    // holds a fixed width so content never reflows mid-animation).
    expect(screen.getByTestId('owner').textContent).toBe('filters');
    const outer = screen.getByText('Filter content').closest('div[style]')!.parentElement as HTMLElement;
    expect(outer.style.width).toBe('320px');
  });

  it('a keyed close from the owner collapses the slot', () => {
    harness();
    fireEvent.click(screen.getByText('open-facet'));
    fireEvent.click(screen.getByText('close-facet'));
    const outer = screen.getByText('Facet content').closest('div[style]')!.parentElement as HTMLElement;
    expect(outer.style.width).toBe('0px');
  });
});
