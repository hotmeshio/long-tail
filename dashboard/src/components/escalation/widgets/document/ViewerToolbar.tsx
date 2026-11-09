import type { MouseEvent, ReactNode } from 'react';
import { isLinkExpired } from './document-source';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Maximize2, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

/** Space between a viewer's frame and the document it holds. */
export const FRAME_PAD = 12;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

export function zoomIn(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.round(zoom * ZOOM_STEP * 100) / 100);
}

export function zoomOut(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.round((zoom / ZOOM_STEP) * 100) / 100);
}

function ToolButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="icon-link p-1.5 rounded-md disabled:opacity-40 disabled:cursor-default"
    >
      {children}
    </button>
  );
}

/**
 * One toolbar for every document kind: paging (PDF only), zoom, rotate, and
 * the open/download pair. Every control is a button, so touch reaches all
 * of it; nothing waits on hover.
 */
export function ViewerToolbar({
  name, url, expiresAt, onRefresh, zoom, onZoom, onRotate, page, pageCount, onPage,
}: {
  name: string;
  url: string;
  /** When the link lapses; a lapsed link asks for a fresh one instead of opening. */
  expiresAt?: string;
  onRefresh?: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onRotate: () => void;
  page?: number;
  pageCount?: number;
  onPage?: (page: number) => void;
}) {
  const icon = 'w-4 h-4';
  const guardLink = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onRefresh && isLinkExpired(expiresAt)) {
      e.preventDefault();
      onRefresh();
    }
  };
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-surface-border flex-wrap" role="toolbar" aria-label={`${name} controls`}>
      <span className="text-xs text-text-secondary truncate min-w-0 flex-1 pl-1" title={name}>{name}</span>
      {pageCount !== undefined && page !== undefined && onPage && (
        <span className="flex items-center gap-0.5">
          <ToolButton label="Previous page" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            <ChevronLeft className={icon} strokeWidth={1.5} />
          </ToolButton>
          <span className="text-2xs tabular-nums text-text-tertiary min-w-[3.5rem] text-center" aria-live="polite">
            {page} / {pageCount}
          </span>
          <ToolButton label="Next page" onClick={() => onPage(page + 1)} disabled={page >= pageCount}>
            <ChevronRight className={icon} strokeWidth={1.5} />
          </ToolButton>
        </span>
      )}
      <span className="flex items-center gap-0.5">
        <ToolButton label="Zoom out" onClick={() => onZoom(zoomOut(zoom))} disabled={zoom <= ZOOM_MIN}>
          <ZoomOut className={icon} strokeWidth={1.5} />
        </ToolButton>
        <ToolButton label="Fit to width" onClick={() => onZoom(1)} disabled={zoom === 1}>
          <Maximize2 className={icon} strokeWidth={1.5} />
        </ToolButton>
        <ToolButton label="Zoom in" onClick={() => onZoom(zoomIn(zoom))} disabled={zoom >= ZOOM_MAX}>
          <ZoomIn className={icon} strokeWidth={1.5} />
        </ToolButton>
        <ToolButton label="Rotate" onClick={onRotate}>
          <RotateCw className={icon} strokeWidth={1.5} />
        </ToolButton>
      </span>
      <span className="flex items-center gap-0.5">
        <a href={url} onClick={guardLink} target="_blank" rel="noopener noreferrer" title="Open in a new tab" aria-label="Open in a new tab" className="icon-link p-1.5 rounded-md">
          <ExternalLink className={icon} strokeWidth={1.5} />
        </a>
        <a href={url} onClick={guardLink} download={name} title="Download" aria-label="Download" className="icon-link p-1.5 rounded-md">
          <Download className={icon} strokeWidth={1.5} />
        </a>
      </span>
    </div>
  );
}
