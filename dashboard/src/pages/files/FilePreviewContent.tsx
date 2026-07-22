import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { TimeAgo } from '../../components/common/display/TimeAgo';

interface FileMetadata {
  path: string;
  content_type: string;
  size: number;
  modified_at: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

export function MetaRow({ label, value, mono, children }: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wider text-text-tertiary mb-0.5">{label}</dt>
      <dd className={`text-sm text-text-secondary ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {children || value}
      </dd>
    </div>
  );
}

export function TextPreview({ url }: { url: string }) {
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

export function FileMetadataDisplay({ metadata }: {
  metadata: FileMetadata;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-3">
      <div>
        <dt className="text-2xs uppercase tracking-wider text-text-tertiary mb-0.5">Path</dt>
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
  );
}

export async function triggerDownload(url: string, name: string) {
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
