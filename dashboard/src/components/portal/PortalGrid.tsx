import type { RolePin } from '../../api/roles';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { PortalPanel } from './PortalPanel';

/** Below this container width (the `split` threshold) every cell stacks into one column. */
export const PORTAL_STACK_REM = 54;

function rootFontPx(): number {
  if (typeof document === 'undefined') return 16;
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * The portal matrix as a page: one grid row per declared row, each dividing
 * its width evenly among its cells, every cell a live panel with its own
 * scroll. A narrow box stacks the cells in declaration order instead.
 */
export function PortalGrid({ rows, resolveUrl, from }: {
  rows: RolePin[][];
  /** Link-variable substitution for a pin URL, applied at render time. */
  resolveUrl: (url: string) => string;
  from: string;
}) {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const stacked = width !== null && width < PORTAL_STACK_REM * rootFontPx();
  const cell = (pin: RolePin, key: string) => <PortalPanel key={key} pin={pin} url={resolveUrl(pin.url)} from={from} />;

  if (stacked) {
    return (
      <div ref={ref} className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 gap-5 auto-rows-[minmax(18rem,auto)]" data-testid="portal-grid" data-stacked="true">
        {rows.flatMap((row, r) => row.map((pin, c) => cell(pin, `${r}-${c}`)))}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="flex-1 min-h-0 grid gap-5"
      style={{ gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` }}
      data-testid="portal-grid"
    >
      {rows.map((row, r) => (
        <div
          key={r}
          className="min-h-0 grid gap-5"
          style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          data-testid="portal-row"
        >
          {row.map((pin, c) => cell(pin, `${r}-${c}`))}
        </div>
      ))}
    </div>
  );
}
