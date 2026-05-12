import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterInput } from '../../components/common/data/FilterBar';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { EmptyState } from '../../components/common/display/EmptyState';
import { useFileBrowse } from '../../api/files';
import { FileBreadcrumbs } from './FileBreadcrumbs';
import { FilePreviewPanel } from './FilePreviewPanel';
import { ListView } from './FileListViews';

const PAGE_SIZES = [25, 50, 100, 200];

export function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefix = searchParams.get('prefix') || '';
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(100);
  const [tokenStack, setTokenStack] = useState<string[]>([]);
  const [currentToken, setCurrentToken] = useState<string | undefined>();

  // Debounce search — refines the prefix sent to S3
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentToken(undefined);
      setTokenStack([]);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const effectivePrefix = debouncedSearch
    ? `${prefix}${debouncedSearch}`
    : prefix;

  const { data, isLoading, isFetching, refetch } = useFileBrowse(effectivePrefix, pageSize, currentToken);

  const directories = data?.directories ?? [];
  const files = data?.files ?? [];
  const nextToken = data?.nextToken;

  const navigateTo = useCallback((newPrefix: string) => {
    setSearch('');
    setDebouncedSearch('');
    setSelectedFile(null);
    setCurrentToken(undefined);
    setTokenStack([]);
    if (newPrefix) {
      setSearchParams({ prefix: newPrefix });
    } else {
      setSearchParams({});
    }
  }, [setSearchParams]);

  function goNextPage() {
    if (!nextToken) return;
    setTokenStack((prev) => [...prev, currentToken || '']);
    setCurrentToken(nextToken);
  }

  function goPrevPage() {
    if (tokenStack.length === 0) return;
    const prev = [...tokenStack];
    const token = prev.pop()!;
    setTokenStack(prev);
    setCurrentToken(token || undefined);
  }

  function changePageSize(size: number) {
    setPageSize(size);
    setCurrentToken(undefined);
    setTokenStack([]);
  }

  const isEmpty = directories.length === 0 && files.length === 0;
  const pageNum = tokenStack.length + 1;
  const hasNextPage = !!nextToken;
  const hasPrevPage = tokenStack.length > 0;

  const apiPath = `/file-browser/browse?prefix=${encodeURIComponent(effectivePrefix)}&pageSize=${pageSize}${currentToken ? `&continuationToken=${encodeURIComponent(currentToken)}` : ''}`;

  return (
    <div className="flex gap-0">
      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <PageHeader title="Files" docsHash="#docs:dashboard.md:files" />

        <FileBreadcrumbs prefix={prefix} onNavigate={navigateTo} />

        <FilterBar actions={
          <ListToolbar
            onRefresh={() => refetch()}
            isFetching={isFetching}
            apiPath={apiPath}
          />
        }>
          <FilterInput
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Filter by prefix..."
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
        ) : (
          <ListView
            directories={directories}
            files={files}
            onNavigate={navigateTo}
            onSelect={setSelectedFile}
            selectedFile={selectedFile}
          />
        )}

        {/* Cursor-based pagination */}
        {(hasPrevPage || hasNextPage || files.length > 0) && (
          <div className="flex items-center justify-between pt-4 pb-2">
            <div className="flex items-center gap-4">
              <p className="text-xs text-text-tertiary">
                Page {pageNum} &middot; {files.length + directories.length} items
              </p>
              <select
                value={pageSize}
                onChange={(e) => changePageSize(parseInt(e.target.value))}
                className="select text-xs py-1"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size} / page</option>
                ))}
              </select>
            </div>
            {(hasPrevPage || hasNextPage) && (
              <div className="flex items-center gap-1">
                <button
                  onClick={goPrevPage}
                  disabled={!hasPrevPage}
                  className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Previous
                </button>
                <button
                  onClick={goNextPage}
                  disabled={!hasNextPage}
                  className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
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
