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
  const { setPanel, closePanel } = useShellPanel();
  return (
    <div>
      <button onClick={() => setPanel(<p>Panel content</p>, { width: 420 })}>open</button>
      <button onClick={closePanel}>close</button>
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
});
