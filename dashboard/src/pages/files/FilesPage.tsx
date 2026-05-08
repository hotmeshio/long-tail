import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Folder,
  File,
  Image,
  FileText,
  FileJson2,
  FileSpreadsheet,
  LayoutGrid,
  LayoutList,
} from 'lucide-react';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterInput } from '../../components/common/data/FilterBar';
import { EmptyState } from '../../components/common/display/EmptyState';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { useFileBrowse, getFilePreviewUrl } from '../../api/files';
import { FileBreadcrumbs } from './FileBreadcrumbs';
import { FilePreviewPanel } from './FilePreviewPanel';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIcon(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return <Image className="w-4 h-4 text-accent/60" strokeWidth={1.5} />;
  }
  if (['json'].includes(ext)) {
    return <FileJson2 className="w-4 h-4 text-accent/60" strokeWidth={1.5} />;
  }
  if (['csv', 'xlsx', 'xls'].includes(ext)) {
    return <FileSpreadsheet className="w-4 h-4 text-accent/60" strokeWidth={1.5} />;
  }
  if (['txt', 'md', 'html', 'xml', 'yaml', 'yml', 'css', 'js', 'ts'].includes(ext)) {
    return <FileText className="w-4 h-4 text-accent/60" strokeWidth={1.5} />;
  }
  return <File className="w-4 h-4 text-accent/60" strokeWidth={1.5} />;
}

function isImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);
}

function dirName(dirPath: string): string {
  const stripped = dirPath.replace(/\/+$/, '');
  return stripped.split('/').pop() || stripped;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

export function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefix = searchParams.get('prefix') || '';
  const [search, setSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const { data, isLoading } = useFileBrowse(prefix);

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
        />
      )}
    </div>
  );
}

function ListView({
  directories,
  files,
  onNavigate,
  onSelect,
  selectedFile,
}: {
  directories: string[];
  files: Array<{ path: string; size: number; modified_at: string }>;
  onNavigate: (prefix: string) => void;
  onSelect: (path: string) => void;
  selectedFile: string | null;
}) {
  return (
    <table className="w-full mt-2">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider text-text-tertiary">
          <th className="pb-2 pl-2 font-medium">Name</th>
          <th className="pb-2 font-medium w-24 text-right">Size</th>
          <th className="pb-2 pr-2 font-medium w-40 text-right">Modified</th>
        </tr>
      </thead>
      <tbody>
        {directories.map((dir) => (
          <tr
            key={dir}
            onClick={() => onNavigate(dir)}
            className="row-hover cursor-pointer group"
          >
            <td className="py-2 pl-2">
              <span className="flex items-center gap-2.5">
                <Folder className="w-4 h-4 text-accent/75 shrink-0" strokeWidth={1.5} />
                <span className="text-sm text-text-primary group-hover:text-accent transition-colors">
                  {dirName(dir)}
                </span>
              </span>
            </td>
            <td className="py-2 text-right text-xs text-text-tertiary">&mdash;</td>
            <td className="py-2 pr-2 text-right text-xs text-text-tertiary">&mdash;</td>
          </tr>
        ))}
        {files.map((file) => (
          <tr
            key={file.path}
            onClick={() => onSelect(file.path)}
            className={`row-hover cursor-pointer group ${
              selectedFile === file.path ? 'bg-surface-hover' : ''
            }`}
          >
            <td className="py-2 pl-2">
              <span className="flex items-center gap-2.5">
                {fileIcon(file.path)}
                <span className="text-sm text-text-primary truncate">
                  {fileNameFromPath(file.path)}
                </span>
              </span>
            </td>
            <td className="py-2 text-right text-xs text-text-secondary tabular-nums">
              {formatSize(file.size)}
            </td>
            <td className="py-2 pr-2 text-right text-xs text-text-secondary">
              <TimeAgo date={file.modified_at} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GridView({
  directories,
  files,
  onNavigate,
  onSelect,
  selectedFile,
}: {
  directories: string[];
  files: Array<{ path: string; size: number; modified_at: string }>;
  onNavigate: (prefix: string) => void;
  onSelect: (path: string) => void;
  selectedFile: string | null;
}) {
  return (
    <div className="mt-4">
      {/* Directories as compact list */}
      {directories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {directories.map((dir) => (
            <button
              key={dir}
              onClick={() => onNavigate(dir)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <Folder className="w-4 h-4 text-accent/75" strokeWidth={1.5} />
              <span>{dirName(dir)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Files as thumbnail grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {files.map((file) => {
          const isImg = isImagePath(file.path);
          return (
            <button
              key={file.path}
              onClick={() => onSelect(file.path)}
              className={`group text-left rounded-lg overflow-hidden transition-all ${
                selectedFile === file.path
                  ? 'ring-2 ring-accent/40 bg-surface-hover'
                  : 'hover:bg-surface-hover'
              }`}
            >
              <div className="aspect-square bg-surface-sunken flex items-center justify-center overflow-hidden">
                {isImg ? (
                  <img
                    src={getFilePreviewUrl(file.path)}
                    alt={fileNameFromPath(file.path)}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-text-tertiary">
                    {fileIcon(file.path)}
                    <span className="text-[10px] uppercase tracking-wider">
                      {file.path.split('.').pop()?.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5">
                <p className="text-xs text-text-primary truncate" title={fileNameFromPath(file.path)}>
                  {fileNameFromPath(file.path)}
                </p>
                <p className="text-[10px] text-text-tertiary tabular-nums">
                  {formatSize(file.size)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
