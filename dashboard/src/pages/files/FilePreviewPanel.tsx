import { useState } from 'react';
import {
  X,
  Download,
  Copy,
  ExternalLink,
  Link,
  Maximize2,
  Check,
} from 'lucide-react';
import { useFileMetadata, getFilePreviewUrl, useGenerateSignedUrl } from '../../api/files';
import { TimeAgo } from '../../components/common/display/TimeAgo';

interface FilePreviewPanelProps {
  filePath: string;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

async function triggerDownload(url: string, name: string) {
  // Fetch as blob so the download attribute works cross-origin
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

export function FilePreviewPanel({ filePath, onClose }: FilePreviewPanelProps) {
  const { data: metadata, isLoading } = useFileMetadata(filePath);
  const signedUrlMutation = useGenerateSignedUrl();
  const [copied, setCopied] = useState<string | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const previewUrl = getFilePreviewUrl(filePath);
  const isImage = metadata?.content_type?.startsWith('image/');
  const isText = metadata?.content_type?.startsWith('text/') || metadata?.content_type === 'application/json';
  const isPdf = metadata?.content_type === 'application/pdf';

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleDownload() {
    try {
      // Short-lived signed URL for the download
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
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // handled by mutation state
    }
  }

  return (
    <>
      {/* Fullscreen overlay for images */}
      {fullscreen && isImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setFullscreen(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setFullscreen(false)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewUrl}
            alt={fileName(filePath)}
            className="max-w-[90vw] max-h-[90vh] object-contain"
          />
        </div>
      )}

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

            {isImage && (
              <button
                onClick={() => setFullscreen(true)}
                className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs"
                title="Fullscreen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Full</span>
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setShowShareMenu((v) => !v)}
                className="btn-ghost flex items-center gap-1.5 !px-2.5 !py-1.5 text-xs"
                title="Share with signed URL"
              >
                <Link className="w-3.5 h-3.5" />
                <span>Share</span>
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
          </div>
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
              {/* Image preview */}
              {isImage && (
                <div className="mb-5">
                  <img
                    src={previewUrl}
                    alt={fileName(filePath)}
                    className="w-full rounded-md bg-surface-sunken object-contain max-h-[400px] cursor-pointer"
                    onClick={() => setFullscreen(true)}
                  />
                </div>
              )}

              {/* Text preview */}
              {isText && (
                <div className="mb-5">
                  <TextPreview url={previewUrl} />
                </div>
              )}

              {/* PDF link */}
              {isPdf && (
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

              {/* Metadata */}
              {metadata && (
                <div className="space-y-3">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-text-tertiary mb-0.5">Path</dt>
                    <dd
                      onClick={() => copyToClipboard(metadata.path, 'path')}
                      className="group flex items-center gap-1.5 text-xs font-mono text-text-secondary break-all cursor-pointer hover:text-text-primary transition-colors"
                      title="Click to copy"
                    >
                      <span className="flex-1">{metadata.path}</span>
                      {copied === 'path'
                        ? <Check className="w-3.5 h-3.5 text-status-success shrink-0" />
                        : <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-text-tertiary shrink-0 transition-opacity" />}
                    </dd>
                  </div>
                  <MetaRow label="Type" value={metadata.content_type} />
                  <MetaRow label="Size" value={formatSize(metadata.size)} />
                  <MetaRow label="Modified">
                    <TimeAgo date={metadata.modified_at} />
                  </MetaRow>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function MetaRow({ label, value, mono, children }: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-text-tertiary mb-0.5">{label}</dt>
      <dd className={`text-sm text-text-secondary ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {children || value}
      </dd>
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  if (content === null && !error) {
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.text();
      })
      .then((text) => setContent(text.slice(0, 100_000)))
      .catch(() => setError(true));
  }

  if (error) return <p className="text-xs text-text-tertiary">Could not load preview</p>;
  if (content === null) {
    return <div className="animate-pulse h-32 bg-surface-sunken rounded" />;
  }

  return (
    <pre className="font-mono text-xs text-text-secondary bg-surface-sunken rounded-md p-3 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words">
      {content}
    </pre>
  );
}
