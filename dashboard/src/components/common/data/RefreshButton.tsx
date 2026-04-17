import { RefreshCw } from 'lucide-react';

interface RefreshButtonProps {
  onClick: () => void;
  isFetching?: boolean;
  label?: string;
}

/**
 * Subtle refresh button with spin animation while fetching.
 * Designed to sit in FilterBar actions or page headers.
 */
export function RefreshButton({ onClick, isFetching = false, label }: RefreshButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={isFetching}
      className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
      title="Refresh"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
      {label && <span>{label}</span>}
    </button>
  );
}
