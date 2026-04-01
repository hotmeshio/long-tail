import { useState } from 'react';
import { Unplug, Trash2, Plus, ChevronDown } from 'lucide-react';
import { useOAuthConnections, useDisconnectOAuth } from '../../api/oauth';
import { getToken } from '../../api/client';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { OAuthIcon } from '../../components/common/OAuthIcon';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { ConfirmDeleteModal } from '../../components/common/modal/ConfirmDeleteModal';

interface ConnectionToRevoke {
  provider: string;
  label: string;
}

const PROVIDERS: Record<string, { name: string; helpText: string; placeholder: string }> = {
  anthropic: {
    name: 'Anthropic',
    helpText: 'Run "claude setup-token" for an OAuth token, or use an API key from console.anthropic.com.',
    placeholder: 'sk-ant-oat01-... or sk-ant-api03-...',
  },
  openai: {
    name: 'OpenAI',
    helpText: 'Create an API key at platform.openai.com/api-keys.',
    placeholder: 'sk-...',
  },
};

export function CredentialsPage() {
  const { data, isLoading } = useOAuthConnections();
  const disconnect = useDisconnectOAuth();
  const [confirmRevoke, setConfirmRevoke] = useState<ConnectionToRevoke | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('anthropic');

  const connections = data?.connections ?? [];

  const handleRevoke = () => {
    if (!confirmRevoke) return;
    disconnect.mutate(
      { provider: confirmRevoke.provider, label: confirmRevoke.label },
      { onSuccess: () => setConfirmRevoke(null) },
    );
  };

  const connectUrl = (provider: string) =>
    `/connect/${provider}?state=${encodeURIComponent(getToken() || '')}`;

  return (
    <div>
      <PageHeader
        title="Credentials"
        actions={
          <button
            onClick={() => setAddOpen((o) => !o)}
            className="btn-primary text-xs inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Credential
          </button>
        }
      />

      <p className="text-sm text-text-secondary mb-6">
        Manage credentials used by tools when invoked on your behalf.
        Each credential is encrypted at rest and resolved automatically during tool execution.
      </p>

      {/* Add credential dropdown */}
      {addOpen && (
        <div className="mb-6 p-4 bg-surface-raised border border-surface-border rounded-md space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary font-medium">Provider</label>
            <div className="relative">
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="input text-xs pr-7 appearance-none"
              >
                {Object.entries(PROVIDERS).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary pointer-events-none" />
            </div>
          </div>
          <p className="text-xs text-text-tertiary">
            {PROVIDERS[selectedProvider]?.helpText}
          </p>
          <a
            href={connectUrl(selectedProvider)}
            className="btn-primary text-xs inline-flex items-center gap-1.5"
          >
            <OAuthIcon provider={selectedProvider} className="w-3.5 h-3.5" />
            Connect {PROVIDERS[selectedProvider]?.name}
          </a>
        </div>
      )}

      {/* Credentials table */}
      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-surface-sunken rounded" />
          ))}
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <Unplug className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No credentials registered.</p>
          <p className="text-xs mt-1">Add a credential to enable tool authentication.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={`${conn.provider}-${conn.label}`}
              className="group/row flex items-center gap-4 px-4 py-3 bg-surface-raised border border-surface-border rounded-md"
            >
              <OAuthIcon provider={conn.provider} className="w-6 h-6 shrink-0" />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary font-medium capitalize">
                    {conn.provider}
                  </span>
                  {conn.label !== 'default' && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-surface-sunken rounded text-text-tertiary">
                      {conn.label}
                    </span>
                  )}
                  {conn.credential_type && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-accent-faint rounded text-accent">
                      {conn.credential_type}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {conn.email && (
                    <span className="text-xs text-text-tertiary">{conn.email}</span>
                  )}
                  {conn.expires_at && (
                    <span className="text-xs text-text-tertiary">
                      Expires <TimeAgo date={conn.expires_at} />
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setConfirmRevoke({ provider: conn.provider, label: conn.label })}
                className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-status-error"
                title="Revoke credential"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDeleteModal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        onConfirm={handleRevoke}
        title="Revoke Credential"
        description={
          <>
            Revoke the{' '}
            <span className="font-medium text-text-primary capitalize">
              {confirmRevoke?.provider}
            </span>
            {confirmRevoke?.label !== 'default' && (
              <> ({confirmRevoke?.label})</>
            )}{' '}
            credential? Tools will no longer be able to use this credential.
          </>
        }
        isPending={disconnect.isPending}
        error={disconnect.error as Error | null}
      />
    </div>
  );
}
