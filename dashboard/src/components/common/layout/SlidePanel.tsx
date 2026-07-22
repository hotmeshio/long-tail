import { useState, useEffect, type ReactNode, type ComponentType } from 'react';
import { X } from 'lucide-react';

/**
 * SlidePanel — the horizontal analog of {@link Collapsible}. A flex child that
 * animates its width open/closed, so sibling content (the main viewport)
 * shrinks and grows with it instead of being overlaid. Content is kept mounted
 * through the closing transition, then unmounted.
 *
 * Usage: place inside a `flex` row next to a `flex-1 min-w-0` main column.
 */
export function SlidePanel({ open, width = 380, children, className = '' }: {
  open: boolean;
  /** Expanded width in pixels. */
  width?: number;
  children: ReactNode;
  className?: string;
}) {
  const [render, setRender] = useState(open);

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  return (
    <div
      className={`shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${className}`}
      style={{ width: open ? width : 0, maxWidth: '50%' }}
      onTransitionEnd={(e) => { if (!open && e.propertyName === 'width') setRender(false); }}
    >
      {/* Fixed inner width so content never reflows during the animation. */}
      <div style={{ width }} className="h-full">
        {render ? children : null}
      </div>
    </div>
  );
}

/**
 * Label/value pair for panel dictionaries — a quiet-but-legible label over a
 * primary-toned value, matching CopyableId so every panel reads the same.
 */
export function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-medium text-text-secondary uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-xs text-text-primary mt-0.5">{children}</dd>
    </div>
  );
}

export interface SlidePanelView {
  id: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  content: ReactNode;
}

/**
 * SlidePanelViews — panel chrome for a set of switchable views: an icon-button
 * radio set at the top selects the active view, a close button dismisses the
 * panel, and the active view's content scrolls beneath. Sits on a light themed
 * background with a left divider so it reads as a callout beside the main
 * content.
 */
export function SlidePanelViews({ views, activeId, onViewChange, onClose, headerActions, stickyClassName }: {
  views: SlidePanelView[];
  activeId: string;
  onViewChange: (id: string) => void;
  /** Renders a close button when provided. Omit when the page has its own toggle affordance. */
  onClose?: () => void;
  /** Page-specific controls (menus, toolbar icons) rendered at the right of the icon row. */
  headerActions?: ReactNode;
  /**
   * Positioning for the view chrome. The default sticks it to the top of the
   * page scroll. Pages with their own sticky top bar pass a sticky variant
   * with an offset; pages that give the panel a fixed-height column (its own
   * independent scroll, like the left nav) pass `"h-full min-h-0"`.
   */
  stickyClassName?: string;
}) {
  const active = views.find((v) => v.id === activeId) ?? views[0];
  if (!active) return null;

  return (
    // Solid (not translucent) background — the panel is a flex sibling, but
    // wide neighbors (tables) can overflow beneath it; nothing may show
    // through. No left border: the background edge alone separates the panel,
    // reading as part of the page rather than a bolted-on drawer.
    <div className="h-full bg-surface-hover">
      {/* Viewport: the view chrome stays visible while content scrolls; the
          full-height wrapper above carries the callout background. In sticky
          mode, z-10 + later DOM order beats sticky table headers (also z-10)
          so neighbors never paint over the panel, while page-level sticky
          bars (FilterBar, z-20) still win. */}
      <div className={`flex flex-col ${stickyClassName ?? 'sticky top-0 z-10 max-h-[calc(100vh-3.5rem)]'}`}>
      <div className="flex items-center justify-between pl-4 pr-3 pt-3 shrink-0">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Panel view">
          {views.map((v) => {
            const Icon = v.icon;
            const isActive = v.id === active.id;
            return (
              <button
                key={v.id}
                role="radio"
                aria-checked={isActive}
                onClick={() => onViewChange(v.id)}
                title={v.label}
                className={`p-1.5 rounded-md transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          {headerActions}
          {onClose && (
            <button
              onClick={onClose}
              title="Close panel"
              className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="px-5 pt-2 pb-1 text-2xs font-semibold uppercase tracking-widest text-text-secondary shrink-0">
        {active.label}
      </p>
      <div className="flex-1 overflow-y-auto px-5 pb-5 pt-1">
        {active.content}
      </div>
      </div>
    </div>
  );
}
