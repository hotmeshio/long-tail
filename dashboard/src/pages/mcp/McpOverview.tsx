import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, RefreshCw, UserPlus } from 'lucide-react';
import { useMcpServers } from '../../api/mcp';
import { PageHeaderWithStats } from '../../components/common/PageHeaderWithStats';
import { TryToolModal } from './TryToolModal';
import type { McpToolManifest, McpServerRecord } from '../../api/types';

// ── Capability cards ─────────────────────────────────────────────────────────

const CAPABILITIES = [
  {
    icon: Eye,
    label: 'Observe',
    detail: 'Query tasks, escalations, and processes in real time',
    toolHint: 'long-tail-db-query',
  },
  {
    icon: RefreshCw,
    label: 'Adapt',
    detail: 'Triage stalled workflows — translate, rotate, retry',
    toolHint: 'long-tail-document-vision',
  },
  {
    icon: UserPlus,
    label: 'Escalate',
    detail: 'Route work to engineers when deterministic flows need updating',
    toolHint: 'long-tail-human-queue',
  },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export function McpOverview() {
  const { data, isLoading } = useMcpServers();
  const servers = data?.servers ?? [];

  const [tryTool, setTryTool] = useState<{
    serverId: string;
    serverName: string;
    tool: McpToolManifest;
  } | null>(null);

  const stats = useMemo(() => {
    const connected = servers.filter((s) => s.status === 'connected').length;
    const totalTools = servers.reduce((sum, s) => {
      if (Array.isArray(s.tool_manifest)) return sum + s.tool_manifest.length;
      return sum;
    }, 0);
    return { total: servers.length, connected, totalTools };
  }, [servers]);

  const v = (n: number) => (isLoading ? '—' : n);

  return (
    <div>
      <PageHeaderWithStats
        title="MCP"
        subtitle="Discover and Adapt"
        stats={[
          { label: 'Connected', value: v(stats.connected), dotClass: 'bg-status-success' },
          { label: 'Tools', value: v(stats.totalTools), dotClass: 'bg-status-active' },
          { label: 'Servers', value: v(stats.total) },
        ]}
      />

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {CAPABILITIES.map((cap) => {
          const server = servers.find((s) => s.name === cap.toolHint);
          return (
            <div
              key={cap.label}
              className="p-5 rounded-lg border border-surface-border/50 hover:border-surface-border transition-colors"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <cap.icon size={15} className="text-text-tertiary" />
                <span className="text-sm font-medium text-text-primary">{cap.label}</span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                {cap.detail}
              </p>
              {server && server.status === 'connected' && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
                  <span className="text-[10px] text-text-tertiary font-mono">{server.name}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Connected servers with their tools */}
      <div className="space-y-6">
        {servers.filter((s) => s.status === 'connected').map((server) => (
          <ServerToolsCard
            key={server.id}
            server={server}
            onTryTool={(tool) =>
              setTryTool({ serverId: server.id, serverName: server.name, tool })
            }
          />
        ))}

        {!isLoading && servers.filter((s) => s.status === 'connected').length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-text-tertiary mb-2">No servers connected</p>
            <Link to="/mcp/servers" className="text-xs text-accent hover:underline">
              Manage servers
            </Link>
          </div>
        )}
      </div>

      {tryTool && (
        <TryToolModal
          open={!!tryTool}
          onClose={() => setTryTool(null)}
          serverId={tryTool.serverId}
          serverName={tryTool.serverName}
          tool={tryTool.tool}
        />
      )}
    </div>
  );
}

// ── Server tools card ────────────────────────────────────────────────────────

function ServerToolsCard({
  server,
  onTryTool,
}: {
  server: McpServerRecord;
  onTryTool: (tool: McpToolManifest) => void;
}) {
  const tools = (server.tool_manifest ?? []) as McpToolManifest[];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
        <span className="text-xs font-mono text-text-secondary">{server.name}</span>
        {server.description && (
          <span className="text-[10px] text-text-tertiary">— {server.description}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tools.map((tool) => {
          const params = Object.keys(tool.inputSchema?.properties ?? {});
          const required = (tool.inputSchema?.required ?? []) as string[];
          return (
            <button
              key={tool.name}
              onClick={() => onTryTool(tool)}
              className="text-left p-3 rounded-md border border-surface-border/40 hover:border-accent/40 hover:bg-surface-sunken/50 transition-colors group"
            >
              <code className="text-xs font-mono text-accent">{tool.name}</code>
              {tool.description && (
                <p className="text-[10px] text-text-tertiary mt-1 line-clamp-1">
                  {tool.description}
                </p>
              )}
              {params.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {params.map((p) => (
                    <span
                      key={p}
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                        required.includes(p)
                          ? 'bg-accent/10 text-accent'
                          : 'bg-surface-sunken text-text-tertiary'
                      }`}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
