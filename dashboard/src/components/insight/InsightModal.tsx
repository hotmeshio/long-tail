import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { InsightResultCard } from './InsightResultCard';
import { McpQueryResultCard } from './McpQueryResultCard';
import type { QueryMode, InsightResult, McpQueryResult } from '../../api/insight';

interface InsightModalProps {
  open: boolean;
  onClose: () => void;
  mode: QueryMode;
  data: InsightResult | McpQueryResult | undefined;
  isFetching: boolean;
  error: Error | null;
}

export function InsightModal({ open, onClose, mode, data, isFetching, error }: InsightModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const title = mode === 'ask' ? 'Insight' : 'MCP Query';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-text-primary/30" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-surface-raised border border-surface-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto">
          {/* Loading skeleton */}
          {isFetching && (
            <div className="space-y-4 animate-pulse">
              <div className="h-4 w-1/4 bg-surface-border/60 rounded" />
              <div className="h-3.5 w-2/3 bg-surface-border/60 rounded" />
              <div className="flex gap-10 mt-2">
                <div className="space-y-2">
                  <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
                  <div className="h-6 w-12 bg-surface-border/60 rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
                  <div className="h-6 w-12 bg-surface-border/60 rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
                  <div className="h-6 w-12 bg-surface-border/60 rounded" />
                </div>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && !isFetching && (
            <div className="p-4 rounded-lg bg-status-error/10">
              <p className="text-sm text-status-error">{error.message}</p>
            </div>
          )}

          {/* Result */}
          {data && !isFetching && mode === 'ask' && (
            <InsightResultCard result={data as InsightResult} />
          )}
          {data && !isFetching && mode === 'do' && (
            <McpQueryResultCard result={data as McpQueryResult} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
