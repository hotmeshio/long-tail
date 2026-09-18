import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../PortalPanel', () => ({
  PortalPanel: ({ pin, url }: { pin: { label: string }; url: string }) => <div data-testid="panel" data-url={url}>{pin.label}</div>,
}));

import { PortalGrid } from '../PortalGrid';

const pin = (label: string) => ({ label, url: `/escalations/available?role=${label}` });
const ROWS = [[pin('board')], [pin('north'), pin('south'), pin('harvest')]];

function fakeResizeObserver(width: number) {
  return class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe() { this.cb([{ contentRect: { width, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => vi.unstubAllGlobals());

describe('PortalGrid', () => {
  it('lays out one grid row per declared row, each dividing its width among its cells', () => {
    render(<PortalGrid rows={ROWS} resolveUrl={(u) => u} from="/portal/fleet" />);
    const grid = screen.getByTestId('portal-grid');
    expect(grid.style.gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))');
    const gridRows = screen.getAllByTestId('portal-row');
    expect(gridRows).toHaveLength(2);
    expect(gridRows[0].style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
    expect(gridRows[1].style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(screen.getAllByTestId('panel').map((p) => p.textContent)).toEqual(['board', 'north', 'south', 'harvest']);
  });

  it('hands each cell its link-variable-resolved URL', () => {
    render(<PortalGrid rows={[[pin('north')]]} resolveUrl={(u) => `${u}&resolved=1`} from="/portal/fleet" />);
    expect(screen.getByTestId('panel')).toHaveAttribute('data-url', '/escalations/available?role=north&resolved=1');
  });

  it('stacks every cell into one column in a narrow box', () => {
    vi.stubGlobal('ResizeObserver', fakeResizeObserver(400));
    render(<PortalGrid rows={ROWS} resolveUrl={(u) => u} from="/portal/fleet" />);
    expect(screen.getByTestId('portal-grid')).toHaveAttribute('data-stacked', 'true');
    expect(screen.queryAllByTestId('portal-row')).toHaveLength(0);
    expect(screen.getAllByTestId('panel')).toHaveLength(4);
  });
});
