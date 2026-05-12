import { useState } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Link,
  Check,
  Trash2,
} from 'lucide-react';
import { useFileMetadata, useFilePreviewUrl, useGenerateSignedUrl, useDeleteFile } from '../../api/files';
import { fileName, triggerDownload, TextPreview, FileMetadataDisplay } from './FilePreviewContent';
import { isImagePath } from './FileListViews';

interface FilePreviewPanelProps {
  filePath: string;
  onClose: () => void;
  onDeleted?: () => void;
}

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
];

export function FilePreviewPanel({ filePath, onClose, onDeleted }: FilePreviewPanelProps) {
  const { data: metadata, isLoading } = useFileMetadata(filePath);
  const signedUrlMutation = useGenerateSignedUrl();
  const deleteMutation = useDeleteFile();
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: previewUrl } = useFilePreviewUrl(filePath);
  const isImage = metadata?.content_type?.startsWith('image/') || isImagePath(filePath);
  const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|json|md|yaml|yml|toml|xml|csv|sql|sh|py|rb|go|rs|java|c|cpp|h|css|scss|html|txt|log|env|ini|cfg|conf)$/i;
  const isText = metadata?.content_type?.startsWith('text/')
    || metadata?.content_type === 'application/json'
    || metadata?.content_type === 'application/xml'
    || (metadata?.content_type === 'application/octet-stream' && TEXT_EXTENSIONS.test(filePath));
  const isPdf = metadata?.content_type === 'application/pdf';

  async function handleDownload() {
    try {
      const result = await signedUrlMutation.mutateAsync({ path: filePath, expiresIn: 3600 });
      const fullUrl = result.url.startsWith('http')
        ? result.url
        : `${window.location.origin}${result.url}`;
      triggerDownload(fullUrl, fileName(filePath));
    } catch {
      // handled by mutation state
    }
  }

  async function handleShare(expiresIn: number) {
    setShowShareMenu(false);
    try {
      const result = await signedUrlMutation.mutateAsync({ path: filePath, expiresIn });
      const fullUrl = result.url.startsWith('http')
        ? result.url
        : `${window.location.origin}${result.url}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // handled by mutation state
    }
  }

  return (
    <>
      {/* Fullscreen — opens image in a new tab */}

      {/* Panel */}
      <div className="w-[380px] shrink-0 border-l border-surface-border bg-surface overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface z-10 px-5 pt-5 pb-3 border-b border-surface-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary truncate pr-2" title={fileName(filePath)}>
              {fileName(filePath)}
            </h3>
            <button onClick={onClose} className="text-text-tertiary hover:text-text-primary shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={handleDownload}
              className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs"
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>

            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs"
              title="Open in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open</span>
            </a>

            <div className="relative">
              <button
                onClick={() => setShowShareMenu((v) => !v)}
                className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs"
                title="Share with signed URL"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Link className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Share'}</span>
              </button>
              {showShareMenu && (
                <div className="absolute top-full left-0 mt-1 bg-surface-raised border border-surface-border rounded-md shadow-lg py-1 z-20 min-w-[120px]">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleShare(opt.value)}
                      className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setConfirmDelete(true)}
              className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs text-status-error/70 hover:text-status-error"
              title="Delete file"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>

          {/* Delete confirmation */}
          {confirmDelete && (
            <div className="mt-3 p-3 bg-status-error/5 border border-status-error/20 rounded-md">
              <p className="text-xs text-text-primary mb-2">
                Permanently delete <span className="font-medium">{fileName(filePath)}</span>? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="btn-secondary text-xs"
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await deleteMutation.mutateAsync(filePath);
                      setConfirmDelete(false);
                      onDeleted?.();
                    } catch {
                      // error shown below
                    }
                  }}
                  className="btn-primary text-xs !bg-status-error hover:!bg-status-error/90"
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
              {deleteMutation.isError && (
                <p className="text-xs text-status-error mt-2">{deleteMutation.error.message}</p>
              )}
            </div>
          )}

          {signedUrlMutation.isError && (
            <p className="text-xs text-status-error mt-2">{signedUrlMutation.error.message}</p>
          )}
        </div>

        {/* Preview area */}
        <div className="p-5">
          {isLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-48 bg-surface-sunken rounded" />
              <div className="h-4 bg-surface-sunken rounded w-2/3" />
            </div>
          ) : (
            <>
              {isImage && previewUrl && (
                <div
                  className="mb-5 rounded-md border border-surface-border bg-surface-sunken overflow-hidden"
                  style={{ maxHeight: '400px' }}
                >
                  <img
                    src={previewUrl}
                    alt={fileName(filePath)}
                    className="w-full object-cover object-top"
                    style={{ maxHeight: '400px' }}
                  />
                </div>
              )}

              {isText && previewUrl && (
                <div className="mb-5">
                  <TextPreview url={previewUrl} />
                </div>
              )}

              {isPdf && previewUrl && (
                <div className="mb-5 p-4 bg-surface-sunken rounded-md text-center">
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent-hover text-sm font-medium"
                  >
                    Open PDF in new tab
                  </a>
                </div>
              )}

              {metadata && (
                <FileMetadataDisplay metadata={metadata} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
