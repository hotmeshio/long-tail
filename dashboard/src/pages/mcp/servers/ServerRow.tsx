import { ChevronRight, Pencil, Trash2, Plug, Unplug, Play } from 'lucide-react';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import {
  useConnectMcpServer,
  useDisconnectMcpServer,
  useCredentialStatus,
} from '../../../api/mcp';
import { StatusBadge } from '../../../components/common/display/StatusBadge';

import type { McpServerRecord, McpToolManifest } from '../../../api/types';
import { isBuiltIn } from './helpers';

function CredentialDot({ serverId, credentialProviders }: { serverId: string; credentialProviders: string[] }) {
  const { data } = useCredentialStatus(serverId);
  if (credentialProviders.length === 0) return null;
  if (!data) return null;
  const ok = data.missing.length === 0;
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-status-success' : 'bg-status-warning'}`}
      title={ok ? 'All credentials registered' : `Missing: ${data.missing.join(', ')}`}
    />
  );
}

export function ServerRow({
  server,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onTryTool,
  connect,
  disconnect,
  visibleTools,
}: {
  server: McpServerRecord;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTryTool: (tool: McpToolManifest) => void;
  connect: ReturnType<typeof useConnectMcpServer>;
  disconnect: ReturnType<typeof useDisconnectMcpServer>;
  visibleTools: McpToolManifest[];
}) {
  const allTools = (server.tool_manifest ?? []) as McpToolManifest[];
  const builtin = isBuiltIn(server);

  return (
    <>
      {/* Server header row */}
      <tr
        onClick={allTools.length > 0 ? onToggle : undefined}
        className={`group/row border-b transition-colors duration-100 ${
          allTools.length > 0 ? 'cursor-pointer row-hover' : ''
        }`}
      >
        {/* Name + tags */}
        <td className="px-6 py-3.5">
          <div className="flex items-center gap-2">
            <span className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''} ${allTools.length === 0 ? 'opacity-0' : 'text-text-tertiary'}`}>
              <ChevronRight size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-text-primary font-medium">{server.name}</p>
              {(server.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {server.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block px-1.5 py-0 text-[9px] font-medium text-text-tertiary bg-surface-sunken rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="px-6 py-3.5 w-28">
          <div className="flex items-center gap-2">
            <StatusBadge status={server.status} />
            <CredentialDot serverId={server.id} credentialProviders={server.credential_providers ?? []} />
          </div>
        </td>

        {/* Actions */}
        <td className="px-6 py-3.5 w-28">
          {builtin ? null : (
            <RowActionGroup>
              {server.status === 'connected' ? (
                <RowAction
                  icon={Unplug}
                  title="Disconnect server"
                  onClick={() => disconnect.mutate(server.id)}
                />
              ) : (
                <RowAction
                  icon={Plug}
                  title="Connect server"
                  onClick={() => connect.mutate(server.id)}
                  colorClass="text-text-tertiary hover:text-status-success"
                />
              )}
              <RowAction
                icon={Pencil}
                title="Edit server"
                onClick={onEdit}
              />
              <RowAction
                icon={Trash2}
                title="Delete server"
                onClick={onDelete}
                colorClass="text-text-tertiary hover:text-status-error"
              />
            </RowActionGroup>
          )}
        </td>

        {/* Tool count badge — aligned with child row hover icons */}
        <td className="w-12 text-center">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-accent/30 text-[10px] font-medium text-accent">
            {allTools.length}
          </span>
        </td>
      </tr>

      {/* Expanded tool rows — description below name, aligned to outer columns */}
      {visibleTools.length > 0 && (
        <tr>
          <td colSpan={4} className="p-0 border-0">
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-in-out"
              style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                {visibleTools.map((tool) => (
                  <div
                    key={tool.name}
                    onClick={() => onTryTool(tool)}
                    className="group/row flex items-center cursor-pointer hover:bg-surface-hover/50 transition-colors border-b border-surface-border/30"
                  >
                    {/* Tool name + description below */}
                    <div className="flex-1 pl-14 pr-6 py-2 min-w-0">
                      <code className="text-xs font-mono text-accent-primary">{tool.name}</code>
                      {tool.description && (
                        <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-1">{tool.description}</p>
                      )}
                    </div>
                    {/* Status — empty for tools */}
                    <div className="w-28 px-6 py-2 shrink-0" />
                    {/* Try — hover-reveal icon */}
                    <div className="w-28 px-6 py-2 flex justify-end shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); onTryTool(tool); }}
                        className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent"
                        title="Try tool"
                      >
                        <Play className="w-[18px] h-[18px]" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="h-1 bg-surface-sunken/20" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
