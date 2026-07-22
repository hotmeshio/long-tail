import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  UploadCloud,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterInput } from '../../components/common/data/FilterBar';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { buildApiPath } from '../../lib/api-path';
import { EmptyState } from '../../components/common/display/EmptyState';
import { DropZone } from '../../components/common/DropZone';
import { useFileBrowse, useUploadFile } from '../../api/files';
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
  const uploadMutation = useUploadFile();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [uploadPrefix, setUploadPrefix] = useState('');

  const handleUploadFiles = useCallback((files: File[]) => {
    setPendingFiles(files);
    setUploadPrefix(prefix);
  }, [prefix]);

  const [uploadError, setUploadError] = useState('');

  const confirmUpload = useCallback(() => {
    if (!pendingFiles) return;
    setUploadError('');
    let remaining = pendingFiles.length;
    for (const file of pendingFiles) {
      const targetPath = `${uploadPrefix}${file.name}`;
      uploadMutation.mutate({ path: targetPath, file }, {
        onSuccess: () => {
          remaining--;
          queryClient.invalidateQueries({ queryKey: ['fileBrowse'] });
          if (remaining <= 0) setPendingFiles(null);
        },
        onError: (err) => {
          remaining--;
          setUploadError(err.message);
          console.error('[Upload] failed:', targetPath, err);
        },
      });
    }
  }, [pendingFiles, uploadPrefix, uploadMutation, queryClient]);

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

  const apiPath = buildApiPath('/file-browser/browse', {
    prefix: effectivePrefix,
    pageSize,
    continuationToken: currentToken || undefined,
  });

  return (
    <DropZone onDrop={handleUploadFiles} label="Drop files to upload">
    <div className="flex gap-0">
      {/* Hidden file input for button-triggered upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) handleUploadFiles(files);
          e.target.value = '';
        }}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-hidden pr-6">
        <PageHeader
          title="Files"
          docsHash="#docs:dashboard.md:files"
          actions={
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="btn-primary text-xs inline-flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </button>
          }
        />

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
          <div className="cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <EmptyState
              icon={UploadCloud}
              title={search ? 'No matching files' : 'No files yet'}
              description={search ? undefined : 'Drop files here or click to upload'}
            />
          </div>
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
    {/* Upload confirmation dialog */}
    {pendingFiles && createPortal(
      <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setPendingFiles(null)} />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-raised border border-surface-border rounded-lg shadow-lg w-full max-w-sm">
            <div className="px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-medium text-text-primary">Upload {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">Destination folder</label>
                <input
                  type="text"
                  value={uploadPrefix}
                  onChange={(e) => setUploadPrefix(e.target.value)}
                  placeholder="e.g., images/ or leave empty for root"
                  className="input text-xs w-full font-mono"
                />
              </div>
              <div className="text-2xs text-text-quaternary space-y-0.5">
                {pendingFiles.map((f, i) => (
                  <p key={i} className="truncate">{uploadPrefix}{f.name} <span className="text-text-tertiary">({(f.size / 1024).toFixed(1)} KB)</span></p>
                ))}
              </div>
              {uploadError && <p className="text-xs text-status-error">{uploadError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border">
              <button onClick={() => setPendingFiles(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={confirmUpload} className="btn-primary text-xs">
                <Upload className="w-3.5 h-3.5 mr-1.5 inline" />
                Upload
              </button>
            </div>
          </div>
        </div>
      </>,
      document.body,
    )}
    </DropZone>
  );
}
