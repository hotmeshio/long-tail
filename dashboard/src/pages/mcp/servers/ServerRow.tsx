import { ChevronRight, Pencil, Trash2, Plug, Unplug } from 'lucide-react';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import {
  useConnectMcpServer,
  useDisconnectMcpServer,
} from '../../../api/mcp';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import type { McpServerRecord, McpToolManifest } from '../../../api/types';
import { isBuiltIn } from './helpers';
import { ToolRow } from './ToolRow';

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
        {/* Expand chevron + name */}
        <td className="px-6 py-3.5">
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''} ${allTools.length === 0 ? 'opacity-0' : 'text-text-tertiary'}`}>
              <ChevronRight size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-text-primary font-medium">{server.name}</p>
              {server.description && (
                <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">{server.description}</p>
              )}
            </div>
          </div>
        </td>

        {/* Transport */}
        <td className="px-6 py-3.5 w-24">
          <span className="text-xs font-mono text-text-secondary">
            {builtin ? 'built-in' : server.transport_type}
          </span>
        </td>

        {/* Status */}
        <td className="px-6 py-3.5 w-32">
          <StatusBadge status={server.status} />
        </td>

        {/* Tool count */}
        <td className="px-6 py-3.5 w-20">
          <span className="text-xs text-text-tertiary">
            {allTools.length} tool{allTools.length !== 1 ? 's' : ''}
          </span>
        </td>

        {/* Updated */}
        <td className="px-6 py-3.5 w-28">
          <TimeAgo date={server.updated_at} />
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
      </tr>

      {/* Animated tool panel */}
      {visibleTools.length > 0 && (
        <tr>
          <td colSpan={6} className="p-0 border-0">
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-in-out"
              style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-sunken/40">
                      <th className="pl-14 pr-6 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                        Tool
                      </th>
                      <th className="px-6 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                        Description
                      </th>
                      <th className="px-6 py-1.5 text-right text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                        Params
                      </th>
                      <th className="px-6 py-1.5 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTools.map((tool) => (
                      <ToolRow
                        key={`${server.id}:${tool.name}`}
                        tool={tool}
                        onTry={() => onTryTool(tool)}
                      />
                    ))}
                  </tbody>
                </table>
                <div className="h-1 bg-surface-sunken/20" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
