import { useState } from 'react';
import { RefreshCw, Link2, Terminal, Check } from 'lucide-react';
import { getToken } from '../../../api/client';
import { LT_BASE } from '../../../lib/base-path';

interface ListToolbarProps {
  onRefresh: () => void;
  isFetching?: boolean;
  /** API path (e.g. "/workflow-states/jobs?limit=50") for URL/curl copy. */
  apiPath?: string;
  /**
   * Set when the toolbar renders outside a `@container/filters` ancestor
   * (e.g. a page header) — skips the narrow-container fold classes, which
   * would otherwise never match and hide the copy actions.
   */
  standalone?: boolean;
}

type CopiedState = 'url' | 'curl' | null;

/**
 * Toolbar for list pages: refresh, copy API URL, copy curl command.
 * Designed to sit in FilterBar `actions` slot.
 */
export function ListToolbar({ onRefresh, isFetching = false, apiPath, standalone = false }: ListToolbarProps) {
  const [copied, setCopied] = useState<CopiedState>(null);

  const copyToClipboard = (text: string, type: CopiedState) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleCopyUrl = () => {
    if (!apiPath) return;
    const url = `${window.location.origin}${LT_BASE}/api${apiPath}`;
    copyToClipboard(url, 'url');
  };

  const handleCopyCurl = () => {
    if (!apiPath) return;
    const url = `${window.location.origin}${LT_BASE}/api${apiPath}`;
    const token = getToken();
    const cmd = token
      ? `curl -H "Authorization: Bearer ${token}" "${url}"`
      : `curl "${url}"`;
    copyToClipboard(cmd, 'curl');
  };

  const BTN = 'p-1 text-text-quaternary hover:text-accent transition-colors rounded';
  const ICON = 'w-2.5 h-2.5';

  return (
    <div className="flex items-center gap-0.5">
      {apiPath && (
        // Developer copy actions yield first at narrow containers — refresh
        // is the affordance the floor actually uses.
        <div className={standalone ? 'flex items-center gap-0.5' : 'hidden @filters/filters:flex items-center gap-0.5'}>
          <button onClick={handleCopyUrl} className={BTN} title="Copy API URL">
            {copied === 'url' ? <Check className={`${ICON} text-status-success`} /> : <Link2 className={ICON} />}
          </button>
          <button onClick={handleCopyCurl} className={BTN} title="Copy curl (includes auth token)">
            {copied === 'curl' ? <Check className={`${ICON} text-status-success`} /> : <Terminal className={ICON} />}
          </button>
        </div>
      )}
      <button onClick={onRefresh} disabled={isFetching} className={`${BTN} disabled:opacity-50`} title="Refresh">
        <RefreshCw className={`${ICON} ${isFetching ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
