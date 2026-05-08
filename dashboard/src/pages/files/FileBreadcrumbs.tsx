import { ChevronRight, FolderOpen } from 'lucide-react';

interface FileBreadcrumbsProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
}

export function FileBreadcrumbs({ prefix, onNavigate }: FileBreadcrumbsProps) {
  const segments = prefix ? prefix.replace(/\/+$/, '').split('/').filter(Boolean) : [];

  return (
    <nav className="flex items-center gap-1 text-sm mb-6 min-h-[28px]">
      <button
        onClick={() => onNavigate('')}
        className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${
          segments.length === 0
            ? 'text-text-primary font-medium'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
        }`}
      >
        <FolderOpen className="w-4 h-4 text-accent/75" strokeWidth={1.5} />
        <span>Files</span>
      </button>

      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        const targetPrefix = segments.slice(0, i + 1).join('/') + '/';
        return (
          <span key={targetPrefix} className="flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
            <button
              onClick={() => onNavigate(targetPrefix)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                isLast
                  ? 'text-text-primary font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {segment}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
