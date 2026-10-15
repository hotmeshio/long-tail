import { useState } from 'react';
import { useConnectedApps, useDisconnectApp, type ConnectedApp, type GrantPreset } from '../../api/oauth-server';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { ConfirmDeleteModal } from '../../components/common/modal/ConfirmDeleteModal';

const ACCESS_LABEL: Record<GrantPreset, string> = {
  read_only: 'Read-only',
  just_me: 'As me',
};

/**
 * The MCP clients the signed-in person has connected with OAuth, and the
 * access each holds. Disconnecting ends the app's access at once.
 */
export function ConnectedAppsPage() {
  const { data, isLoading } = useConnectedApps();
  const disconnect = useDisconnectApp();
  const [toDisconnect, setToDisconnect] = useState<ConnectedApp | null>(null);
  const apps = data?.grants ?? [];

  const confirmDisconnect = () => {
    if (!toDisconnect) return;
    disconnect.mutate(toDisconnect.grant_id, { onSuccess: () => setToDisconnect(null) });
  };

  return (
    <div>
      <PageHeader title="Connected apps" />

      <p className="text-sm text-text-secondary mb-6">
        Review the apps that act as you through MCP. Disconnect one to end its access at once.
      </p>

      {isLoading ? null : apps.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          Connect an app, such as Claude, from the app itself: add this deployment as an MCP server and sign in.
        </p>
      ) : (
        <div className="divide-y divide-surface-border/30">
          {apps.map((app) => (
            <div key={app.grant_id} className="flex items-center gap-4 px-3 py-2.5 -mx-3" data-testid="connected-app">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-text-primary font-medium truncate" title={app.client_name ?? app.client_id}>
                    {app.client_name || app.client_id}
                  </span>
                  <span className="text-2xs px-1.5 py-0.5 bg-accent-faint rounded text-accent shrink-0">
                    {ACCESS_LABEL[app.policy.preset] ?? app.scope}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-text-tertiary">
                  <span>Connected <TimeAgo date={app.created_at} /></span>
                  {app.last_used_at && <span>Last refreshed <TimeAgo date={app.last_used_at} /></span>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setToDisconnect(app)}
                className="btn-ghost text-xs shrink-0"
              >
                Disconnect
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDeleteModal
        open={!!toDisconnect}
        onClose={() => setToDisconnect(null)}
        onConfirm={confirmDisconnect}
        title="Disconnect app"
        description={
          <>
            Disconnect{' '}
            <span className="font-medium text-text-primary">{toDisconnect?.client_name || toDisconnect?.client_id}</span>?
            Its access ends at once; connect it again from the app to restore it.
          </>
        }
        isPending={disconnect.isPending}
        error={disconnect.error as Error | null}
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting..."
      />
    </div>
  );
}
