import { useState } from 'react';
import { RotateCcw, Play } from 'lucide-react';
import { useCallMcpTool } from '../../api/mcp';
import { Modal } from '../../components/common/Modal';
import { JsonViewer } from '../../components/common/JsonViewer';
import type { McpToolManifest } from '../../api/types';

interface TryToolModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  serverName: string;
  tool: McpToolManifest;
}

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

export function TryToolModal({ open, onClose, serverId, serverName, tool }: TryToolModalProps) {
  const callTool = useCallMcpTool();
  const [argsJson, setArgsJson] = useState(
    JSON.stringify(buildSkeleton(tool.inputSchema), null, 2),
  );
  const [jsonError, setJsonError] = useState('');

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
    <Modal open={open} onClose={onClose} title={`${serverName} / ${tool.name}`} maxWidth="max-w-2xl">
      <div className="flex flex-col gap-4">
        {/* Tool description */}
        <p className="text-xs text-text-secondary">{tool.description}</p>

        {/* Request */}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            Request
          </label>
          <textarea
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
            rows={8}
            spellCheck={false}
          />
          {jsonError && <p className="text-xs text-status-error mt-1">{jsonError}</p>}
        </div>

        {/* Response */}
        {callTool.isPending && (
          <div className="animate-pulse">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Response</p>
            <div className="h-20 bg-surface-sunken rounded-md" />
          </div>
        )}
        {callTool.data ? (
          <JsonViewer data={callTool.data as Record<string, unknown>} label="Response" />
        ) : null}
        {callTool.error ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Response</p>
            <div className="bg-status-error/10 border border-status-error/20 rounded-md px-3 py-2">
              <p className="text-xs text-status-error">
                {callTool.error instanceof Error ? callTool.error.message : 'Tool call failed'}
              </p>
            </div>
          </div>
        ) : null}

        {/* Actions — pinned at bottom */}
        <div className="flex justify-end gap-3 pt-2 border-t border-surface-border">
          <button
            onClick={onClose}
            className="btn-ghost text-xs"
          >
            Close
          </button>
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
        </div>
      </div>
    </Modal>
  );
}
