import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, RotateCcw, Play, ExternalLink, KeyRound, User } from 'lucide-react';
import { useCallMcpTool } from '../../../api/mcp';
import { useAuth } from '../../../hooks/useAuth';
import { JsonViewer } from '../data/JsonViewer';
import type { McpToolManifest } from '../../../api/types';

function buildSkeleton(schema: Record<string, any>): Record<string, any> {
  if (!schema?.properties) return {};
  const result: Record<string, any> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const p = prop as any;
    if (p.default !== undefined) result[key] = p.default;
    else if (p.type === 'string') result[key] = '';
    else if (p.type === 'number' || p.type === 'integer') result[key] = 0;
    else if (p.type === 'boolean') result[key] = false;
    else if (p.type === 'object') result[key] = {};
    else if (p.type === 'array') result[key] = [];
    else result[key] = null;
  }
  return result;
}

function ToolErrorDisplay({ error }: { error: Error | null }) {
  const msg = error instanceof Error ? error.message : '';
  if (msg.startsWith('No credential found for provider')) {
    return (
      <div className="bg-status-warning/10 border border-status-warning/30 rounded-md px-3 py-2 flex items-start gap-2">
        <KeyRound size={14} className="text-status-warning mt-0.5 shrink-0" />
        <div>
          <p className="text-[11px] font-medium text-text-primary mb-0.5">Credential required</p>
          <p className="text-[11px] text-text-secondary mb-1">{msg}</p>
          <Link to="/credentials" className="text-[11px] text-accent hover:underline inline-flex items-center gap-1">
            Go to Credentials <ExternalLink size={10} />
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-status-error/10 border border-status-error/20 rounded-md px-3 py-2">
      <p className="text-[11px] text-status-error">{msg || 'Tool call failed'}</p>
    </div>
  );
}

function ExecutionLink({ data }: { data: unknown }) {
  const res = (data as any)?.result;
  const jobId = res?.job_id;
  const ns = res?.namespace || 'longtail';
  if (!jobId) return null;
  return (
    <Link
      to={`/mcp/executions/${encodeURIComponent(jobId)}?namespace=${encodeURIComponent(ns)}`}
      className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
    >
      <ExternalLink size={12} />
      View Execution
    </Link>
  );
}

interface ToolTestPanelProps {
  serverId: string;
  serverName: string;
  tool: McpToolManifest;
  onClose: () => void;
}

export function ToolTestPanel({ serverId, serverName, tool, onClose }: ToolTestPanelProps) {
  const { user } = useAuth();
  const callTool = useCallMcpTool();
  const [argsJson, setArgsJson] = useState('');
  const [jsonError, setJsonError] = useState('');

  // Reset state when tool changes
  useEffect(() => {
    setArgsJson(JSON.stringify(buildSkeleton(tool.inputSchema), null, 2));
    setJsonError('');
    callTool.reset();
  }, [tool.name, serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasResult = !!callTool.data || !!callTool.error;

  const handleRun = () => {
    setJsonError('');
    callTool.reset();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(argsJson);
    } catch {
      setJsonError('Invalid JSON');
      return;
    }
    callTool.mutate({ serverId, toolName: tool.name, arguments: parsed });
  };

  return (
    <div className="border-l border-surface-border bg-surface-raised flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">{serverName}</p>
          <code className="text-[11px] font-mono text-accent truncate block">{tool.name}</code>
        </div>
        <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary shrink-0 ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Identity context */}
        {user && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent/[0.06] border border-accent/20">
            <User className="w-3 h-3 text-accent/75 shrink-0" strokeWidth={1.5} />
            <span className="text-[10px] text-text-secondary">
              Calling as <span className="font-medium text-accent">{user.displayName || user.userId}</span>
            </span>
          </div>
        )}

        {/* Description */}
        {tool.description && (
          <p className="text-[11px] text-text-secondary leading-relaxed">{tool.description}</p>
        )}

        {/* Request */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Request
          </label>
          <textarea
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary resize-y"
            rows={6}
            spellCheck={false}
          />
          {jsonError && <p className="text-[11px] text-status-error mt-1">{jsonError}</p>}
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={callTool.isPending}
          className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {callTool.isPending ? (
            'Running...'
          ) : hasResult ? (
            <><RotateCcw size={12} /> Re-run</>
          ) : (
            <><Play size={12} /> Run</>
          )}
        </button>

        {/* Response */}
        {callTool.isPending && (
          <div className="animate-pulse">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Response</p>
            <div className="h-20 bg-surface-sunken rounded-md" />
          </div>
        )}
        {callTool.data ? (
          <div className="space-y-2">
            <JsonViewer data={callTool.data as Record<string, unknown>} label="Response" defaultCollapsed />
            <ExecutionLink data={callTool.data} />
          </div>
        ) : null}
        {callTool.error ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Response</p>
            <ToolErrorDisplay error={callTool.error as Error | null} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
