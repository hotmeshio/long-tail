import { useState } from 'react';
import { Unplug, Trash2, Plus } from 'lucide-react';
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

export function ConnectionsPage() {
  const { data, isLoading } = useOAuthConnections();
  const disconnect = useDisconnectOAuth();
  const [confirmRevoke, setConfirmRevoke] = useState<ConnectionToRevoke | null>(null);

  const connections = data?.connections ?? [];

  const handleRevoke = () => {
    if (!confirmRevoke) return;
    disconnect.mutate(
      { provider: confirmRevoke.provider, label: confirmRevoke.label },
      { onSuccess: () => setConfirmRevoke(null) },
    );
  };

  const connectUrl = (provider: string) =>
    `/api/auth/oauth/connect/${provider}?token=${encodeURIComponent(getToken() || '')}&returnTo=/connections`;

  return (
    <div>
      <PageHeader
        title="Connections"
        actions={
          <a href={connectUrl('anthropic')} className="btn-primary text-xs inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Connect Anthropic
          </a>
        }
      />

      <p className="text-sm text-text-secondary mb-6">
        Manage credentials used by tools when invoked on your behalf.
        Each connection stores an encrypted token that activities use to authenticate with external services.
      </p>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-surface-sunken rounded" />
          ))}
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <Unplug className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No connections yet.</p>
          <p className="text-xs mt-1">Connect a provider to enable tool authentication.</p>
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
                title="Revoke connection"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-surface-border">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
          Add Connection
        </p>
        <div className="flex gap-3">
          <a
            href={connectUrl('anthropic')}
            className="flex items-center gap-2 px-4 py-2.5 bg-surface-raised border border-surface-border rounded-md hover:bg-surface-hover text-xs text-text-secondary"
          >
            <OAuthIcon provider="anthropic" className="w-4 h-4" />
            Anthropic
          </a>
        </div>
        <p className="text-xs text-text-tertiary mt-2">
          More providers can be configured via environment variables (OAUTH_GOOGLE_CLIENT_ID, etc.)
        </p>
      </div>

      <ConfirmDeleteModal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        onConfirm={handleRevoke}
        title="Revoke Connection"
        description={
          <>
            Revoke the{' '}
            <span className="font-medium text-text-primary capitalize">
              {confirmRevoke?.provider}
            </span>
            {confirmRevoke?.label !== 'default' && (
              <> ({confirmRevoke?.label})</>
            )}{' '}
            connection? Tools will no longer be able to use this credential.
          </>
        }
        isPending={disconnect.isPending}
        error={disconnect.error as Error | null}
      />
    </div>
  );
}
