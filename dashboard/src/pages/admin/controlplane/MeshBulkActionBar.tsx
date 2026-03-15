interface MeshBulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  onThrottle: () => void;
  isPending: boolean;
}

export function MeshBulkActionBar({ selectedCount, onClear, onThrottle, isPending }: MeshBulkActionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-accent/5 border border-accent/20 rounded-lg mb-4">
      <span className="text-xs font-medium text-accent">
        {selectedCount} selected
      </span>
      <div className="w-px h-5 bg-surface-border" />
      <button
        onClick={onThrottle}
        disabled={isPending}
        className="btn-secondary text-xs py-1.5 disabled:opacity-50"
      >
        Adjust Throttle...
      </button>
      <div className="flex-1" />
      <button
        onClick={onClear}
        className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
      >
        Clear
      </button>
    </div>
  );
}
