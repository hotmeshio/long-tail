import {
  Folder,
  File,
  Image,
  FileText,
  FileJson2,
  FileSpreadsheet,
} from 'lucide-react';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { getFilePreviewUrl } from '../../api/files';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function fileIcon(filePath: string) {
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

export function isImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);
}

export function dirName(dirPath: string): string {
  const stripped = dirPath.replace(/\/+$/, '');
  return stripped.split('/').pop() || stripped;
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

interface ViewProps {
  directories: string[];
  files: Array<{ path: string; size: number; modified_at: string }>;
  onNavigate: (prefix: string) => void;
  onSelect: (path: string) => void;
  selectedFile: string | null;
}

export function ListView({ directories, files, onNavigate, onSelect, selectedFile }: ViewProps) {
  return (
    <table className="w-full mt-2">
      <thead>
        <tr className="text-left text-2xs uppercase tracking-wider text-text-tertiary">
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

export function GridView({ directories, files, onNavigate, onSelect, selectedFile }: ViewProps) {
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
                    <span className="text-2xs uppercase tracking-wider">
                      {file.path.split('.').pop()?.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5">
                <p className="text-xs text-text-primary truncate" title={fileNameFromPath(file.path)}>
                  {fileNameFromPath(file.path)}
                </p>
                <p className="text-2xs text-text-tertiary tabular-nums">
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
