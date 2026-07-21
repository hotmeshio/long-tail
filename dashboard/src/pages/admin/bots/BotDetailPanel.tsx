import { useState, useMemo } from 'react';
import { Trash2, Key, Plus, Copy, Check } from 'lucide-react';
import {
  useBotApiKeys,
  useCreateBotApiKey,
  useRevokeBotApiKey,
  useAddBotRole,
  useRemoveBotRole,
} from '../../../api/bots';
import { useRoles } from '../../../api/roles';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RolePill } from '../../../components/common/display/RolePill';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import type { BotRecord, BotApiKeyRecord, LTRoleType } from '../../../api/types';

function ApiKeysSection({ botId }: { botId: string }) {
  const { data } = useBotApiKeys(botId);
  const createKey = useCreateBotApiKey();
  const revokeKey = useRevokeBotApiKey();

  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScope, setSelectedScope] = useState<'read' | 'full'>('read');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<BotApiKeyRecord | null>(null);

  const keys = data?.keys ?? [];

  const SCOPE_PRESETS = {
    read: { label: 'Read only', scopes: ['mcp:read'], hint: 'Discovery and monitoring — read-safe tools only' },
    full: { label: 'Full access', scopes: ['mcp:read', 'mcp:full'], hint: 'All tools — can modify state' },
  } as const;

  const handleGenerate = () => {
    if (!newKeyName.trim()) return;
    createKey.mutate(
      { botId, name: newKeyName.trim(), scopes: SCOPE_PRESETS[selectedScope].scopes as unknown as string[] },
      {
        onSuccess: (result: any) => {
          setGeneratedKey(result.rawKey);
          setNewKeyName('');
        },
      },
    );
  };

  const handleCopy = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = () => {
    if (!confirmRevoke) return;
    revokeKey.mutate(
      { botId, keyId: confirmRevoke.id },
      { onSuccess: () => setConfirmRevoke(null) },
    );
  };

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">
        API Keys
      </p>

      {generatedKey && (
        <div className="mb-3 p-3 bg-status-success/10 border border-status-success/30 rounded-md">
          <p className="text-[10px] font-semibold text-status-success mb-1">
            Key generated — copy now, it won't be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="text-[11px] font-mono text-text-primary bg-surface-sunken px-2 py-1 rounded flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {generatedKey}
            </code>
            <button
              onClick={handleCopy}
              className="text-text-tertiary hover:text-text-primary shrink-0"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-xs text-text-tertiary mb-3">No API keys.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {keys.map((k) => (
            <div
              key={k.id}
              className="group/key flex items-center justify-between px-2.5 py-1.5 bg-surface-sunken rounded text-xs"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Key className="w-3 h-3 text-text-tertiary" />
                <span className="text-text-primary font-mono">{k.name}</span>
                {(k.scopes ?? []).map((s: string) => (
                  <span key={s} className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${s.includes('full') ? 'bg-status-warning/15 text-status-warning' : 'bg-accent/10 text-accent'}`}>
                    {s}
                  </span>
                ))}
                {k.last_used_at && (
                  <span className="text-[10px] text-text-tertiary">
                    used <TimeAgo date={k.last_used_at} />
                  </span>
                )}
              </div>
              <button
                onClick={() => setConfirmRevoke(k)}
                className="opacity-0 group-hover/key:opacity-100 transition-opacity text-text-tertiary hover:text-status-error"
                title="Revoke key"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Stacked like the user panel's Add Role form — the input takes the
          full row, then the fixed-width scope toggle and button share the
          second row. Nothing here can widen the 360px column. */}
      <div className="space-y-2">
        <input
          type="text"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Key name..."
          className="input text-xs font-mono"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-md border border-surface-border overflow-hidden shrink-0">
            {(Object.entries(SCOPE_PRESETS) as [keyof typeof SCOPE_PRESETS, typeof SCOPE_PRESETS[keyof typeof SCOPE_PRESETS]][]).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedScope(key)}
                title={preset.hint}
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  selectedScope === key
                    ? 'bg-accent text-white'
                    : 'bg-surface text-text-secondary hover:bg-surface-hover'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleGenerate}
            disabled={!newKeyName.trim() || createKey.isPending}
            className="btn-primary text-xs inline-flex items-center gap-1 shrink-0"
          >
            <Plus className="w-3 h-3" />
            {createKey.isPending ? '...' : 'Generate'}
          </button>
        </div>
      </div>
      {createKey.error && (
        <p className="text-[10px] text-status-error mt-1">{(createKey.error as Error).message}</p>
      )}

      <ConfirmDeleteModal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        onConfirm={handleRevoke}
        title="Revoke API Key"
        description={
          <>
            Revoke API key{' '}
            <span className="font-medium text-text-primary font-mono">
              {confirmRevoke?.name}
            </span>
            ? This bot will no longer be able to authenticate with this key.
          </>
        }
        isPending={revokeKey.isPending}
        error={revokeKey.error as Error | null}
      />
    </div>
  );
}

function RolesSection({ bot }: { bot: BotRecord }) {
  const { data: allRolesData } = useRoles();
  const addRole = useAddBotRole();
  const removeRole = useRemoveBotRole();
  const [newRole, setNewRole] = useState('');
  const [newType, setNewType] = useState<LTRoleType>('member');

  const allRoles = allRolesData?.roles ?? [];
  const currentRoles = bot.roles ?? [];

  const available = useMemo(() => {
    const assigned = new Set(currentRoles.map((r) => r.role));
    return allRoles.filter((r) => !assigned.has(r));
  }, [allRoles, currentRoles]);

  const handleAdd = () => {
    if (!newRole.trim()) return;
    addRole.mutate(
      { botId: bot.id, role: newRole.trim(), type: newType },
      { onSuccess: () => { setNewRole(''); setNewType('member'); } },
    );
  };

  const handleRemove = (role: string) => {
    removeRole.mutate({ botId: bot.id, role });
  };

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">
        Roles
      </p>

      {currentRoles.length === 0 ? (
        <p className="text-xs text-text-tertiary mb-3">No roles assigned.</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {currentRoles.map((r) => (
            <span
              key={r.role}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-surface-sunken rounded-full text-text-secondary"
            >
              <RolePill role={r.role} />
              <span className="text-[9px] text-text-tertiary">{r.type}</span>
              <button
                onClick={() => handleRemove(r.role)}
                className="text-text-tertiary hover:text-status-error transition-colors ml-0.5"
                title={`Remove ${r.role}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="space-y-2">
          {/* Same stacked form as the user panel's Add Role — full-width
              selects that can never push the button off-screen. */}
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="select text-xs font-mono w-full min-w-0"
            aria-label="Role"
          >
            <option value="">Select a role...</option>
            {available.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div className="min-w-0">
              <label className="block text-[10px] text-text-tertiary mb-1">Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as LTRoleType)}
                className="select text-xs w-full min-w-0"
                aria-label="Role type"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="superadmin">superadmin</option>
              </select>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleAdd}
                disabled={!newRole || addRole.isPending}
                className="btn-primary text-xs"
              >
                {addRole.isPending ? '...' : 'Add Role'}
              </button>
            </div>
          </div>
        </div>
      )}
      {addRole.error && (
        <p className="text-[10px] text-status-error mt-1">{(addRole.error as Error).message}</p>
      )}
    </div>
  );
}

export function BotDetailPanel({ bot }: { bot: BotRecord | null }) {
  if (!bot) {
    return (
      <div className="border-l border-surface-border pl-6 pt-4 min-h-[300px]">
        <p className="text-xs text-text-tertiary">
          Select a service account to manage its API keys and roles.
        </p>
      </div>
    );
  }

  return (
    <div className="border-l border-surface-border pl-6 pt-4 min-h-[300px] space-y-6">
      <div>
        <p className="text-sm text-text-primary">{bot.display_name || bot.external_id}</p>
        {bot.description && (
          <p className="text-xs text-text-tertiary mt-0.5">{bot.description}</p>
        )}
      </div>

      <ApiKeysSection botId={bot.id} />
      <RolesSection bot={bot} />
    </div>
  );
}
