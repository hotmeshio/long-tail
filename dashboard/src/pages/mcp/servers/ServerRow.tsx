import { ChevronRight, Pencil, Trash2, Plug, Unplug, Play } from 'lucide-react';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import {
  useConnectMcpServer,
  useDisconnectMcpServer,
} from '../../../api/mcp';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { ToolPill } from '../../../components/common/display/ToolPill';
import { ServerName } from '../../../components/common/display/ServerName';

import type { McpServerRecord, McpToolManifest } from '../../../api/types';
import { isBuiltIn } from './helpers';

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
  const tags = server.tags ?? [];

  return (
    <>
      {/* Server header row */}
      <tr
        onClick={allTools.length > 0 ? onToggle : undefined}
        className={`group/row border-b border-surface-border/50 transition-colors duration-100 ${
          allTools.length > 0 ? 'cursor-pointer row-hover' : ''
        }`}
      >
        {/* Name + tags */}
        <td className="px-6 py-2.5">
          <div className="flex items-center gap-3">
            <span className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''} ${allTools.length === 0 ? 'opacity-0' : 'text-text-tertiary'}`}>
              <ChevronRight size={14} />
            </span>
            <span className="flex items-center gap-1.5">
              <ServerName name={server.name} serverId={server.id} short={false} />
              {allTools.length > 0 && (
                <sup className="text-[9px] font-normal text-accent/70">{allTools.length}</sup>
              )}
            </span>
            {tags.length > 0 && (
              <div className="flex gap-1 ml-auto shrink-0">
                {tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="inline-block px-1.5 py-0 text-[9px] text-text-tertiary bg-surface-sunken rounded">
                    {tag}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="text-[9px] text-text-quaternary" title={tags.slice(3).join(', ')}>&hellip;</span>
                )}
              </div>
            )}
          </div>
        </td>

        {/* Status */}
        <td className="px-4 py-2.5 w-28 whitespace-nowrap">
          <StatusBadge status={server.status} />
        </td>

        {/* Actions */}
        <td className="px-4 py-2.5 w-16">
          <RowActionGroup>
            {!builtin && (
              server.status === 'connected' ? (
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
              )
            )}
            <RowAction
              icon={Pencil}
              title="Edit server"
              onClick={onEdit}
            />
            {!builtin && (
              <RowAction
                icon={Trash2}
                title="Delete server"
                onClick={onDelete}
                colorClass="text-text-tertiary hover:text-status-error"
              />
            )}
          </RowActionGroup>
        </td>
      </tr>

      {/* Expanded tool rows — real table rows for column alignment */}
      {expanded && visibleTools.map((tool) => (
        <tr
          key={tool.name}
          onClick={() => onTryTool(tool)}
          className="group/row cursor-pointer hover:bg-surface-hover/50 transition-colors border-b border-surface-border/15"
        >
          {/* Tool name + description */}
          <td className="pl-14 pr-6 py-2.5">
            <ToolPill name={tool.name} size="md" />
            {tool.description && (
              <p className="text-[11px] leading-snug text-text-quaternary mt-0.5">{tool.description}</p>
            )}
          </td>

          {/* Status — empty for tools */}
          <td className="px-4 py-2.5 w-28" />

          {/* Actions — play on hover */}
          <td className="px-4 py-2.5 w-16">
            <div className="flex items-center justify-end">
              <button
                onClick={(e) => { e.stopPropagation(); onTryTool(tool); }}
                className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent"
                title="Try tool"
              >
                <Play className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
