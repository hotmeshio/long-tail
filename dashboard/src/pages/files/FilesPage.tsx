import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutGrid,
  LayoutList,
} from 'lucide-react';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterInput } from '../../components/common/data/FilterBar';
import { EmptyState } from '../../components/common/display/EmptyState';
import { useFileBrowse } from '../../api/files';
import { FileBreadcrumbs } from './FileBreadcrumbs';
import { FilePreviewPanel } from './FilePreviewPanel';
import { ListView, GridView, isImagePath, dirName, fileNameFromPath } from './FileListViews';

export function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefix = searchParams.get('prefix') || '';
  const [search, setSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const { data, isLoading, refetch } = useFileBrowse(prefix);

  const directories = data?.directories ?? [];
  const files = data?.files ?? [];

  const filtered = useMemo(() => {
    if (!search) return { directories, files };
    const q = search.toLowerCase();
    return {
      directories: directories.filter((d) => dirName(d).toLowerCase().includes(q)),
      files: files.filter((f) => fileNameFromPath(f.path).toLowerCase().includes(q)),
    };
  }, [directories, files, search]);

  function navigateTo(newPrefix: string) {
    setSearch('');
    setSelectedFile(null);
    if (newPrefix) {
      setSearchParams({ prefix: newPrefix });
    } else {
      setSearchParams({});
    }
  }

  const hasImages = filtered.files.some((f) => isImagePath(f.path));
  const isEmpty = filtered.directories.length === 0 && filtered.files.length === 0;

  return (
    <div className="flex gap-0">
      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <PageHeader
          title="Files"
          actions={
            hasImages ? (
              <div className="flex items-center border border-surface-border rounded-md overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-surface-hover text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                  title="List view"
                >
                  <LayoutList className="w-4 h-4" strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-surface-hover text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                  title="Grid view"
                >
                  <LayoutGrid className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>
            ) : undefined
          }
        />

        <FileBreadcrumbs prefix={prefix} onNavigate={navigateTo} />

        <FilterBar>
          <FilterInput
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Filter by name..."
          />
        </FilterBar>

        {isLoading ? (
          <div className="animate-pulse space-y-2 mt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-surface-sunken rounded" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState title={search ? 'No matching files' : 'This directory is empty'} />
        ) : viewMode === 'grid' ? (
          <GridView
            directories={filtered.directories}
            files={filtered.files}
            onNavigate={navigateTo}
            onSelect={setSelectedFile}
            selectedFile={selectedFile}
          />
        ) : (
          <ListView
            directories={filtered.directories}
            files={filtered.files}
            onNavigate={navigateTo}
            onSelect={setSelectedFile}
            selectedFile={selectedFile}
          />
        )}
      </div>

      {/* Preview panel */}
      {selectedFile && (
        <FilePreviewPanel
          filePath={selectedFile}
          onClose={() => setSelectedFile(null)}
          onDeleted={() => { setSelectedFile(null); refetch(); }}
        />
      )}
    </div>
  );
}
