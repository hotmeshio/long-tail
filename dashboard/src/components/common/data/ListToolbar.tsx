import { useState } from 'react';
import { RefreshCw, Link2, Terminal, Check } from 'lucide-react';
import { getToken } from '../../../api/client';

interface ListToolbarProps {
  onRefresh: () => void;
  isFetching?: boolean;
  /** API path (e.g. "/workflow-states/jobs?limit=50") for URL/curl copy. */
  apiPath?: string;
}

type CopiedState = 'url' | 'curl' | null;

/**
 * Toolbar for list pages: refresh, copy API URL, copy curl command.
 * Designed to sit in FilterBar `actions` slot.
 */
export function ListToolbar({ onRefresh, isFetching = false, apiPath }: ListToolbarProps) {
  const [copied, setCopied] = useState<CopiedState>(null);

  const copyToClipboard = (text: string, type: CopiedState) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleCopyUrl = () => {
    if (!apiPath) return;
    const url = `${window.location.origin}/api${apiPath}`;
    copyToClipboard(url, 'url');
  };

  const handleCopyCurl = () => {
    if (!apiPath) return;
    const url = `${window.location.origin}/api${apiPath}`;
    const token = getToken();
    const cmd = token
      ? `curl -H "Authorization: Bearer ${token}" "${url}"`
      : `curl "${url}"`;
    copyToClipboard(cmd, 'curl');
  };

  const BTN_SECONDARY = 'p-1.5 text-text-tertiary/70 hover:text-text-secondary transition-colors rounded';
  const ICON_SM = 'w-2.5 h-2.5';

  return (
    <div className="flex items-center gap-0.5">
      {apiPath && (
        <>
          <button onClick={handleCopyUrl} className={BTN_SECONDARY} title="Copy API URL">
            {copied === 'url' ? <Check className={`${ICON_SM} text-status-success`} /> : <Link2 className={ICON_SM} />}
          </button>
          <button onClick={handleCopyCurl} className={BTN_SECONDARY} title="Copy curl (includes auth token)">
            {copied === 'curl' ? <Check className={`${ICON_SM} text-status-success`} /> : <Terminal className={ICON_SM} />}
          </button>
        </>
      )}
      <button onClick={onRefresh} disabled={isFetching} className="p-1.5 text-accent/75 hover:text-accent transition-colors disabled:opacity-50 rounded" title="Refresh">
        <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
