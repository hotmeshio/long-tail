import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, RotateCcw, Play, ExternalLink, KeyRound } from 'lucide-react';
import { useCallMcpTool } from '../../../api/mcp';
import { JsonViewer } from '../data/JsonViewer';
import { RunAsSelector } from '../form/RunAsSelector';
import type { McpToolManifest } from '../../../api/types';
import { buildSkeleton } from '../../../pages/mcp/mcp-query-detail/helpers';

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
  const callTool = useCallMcpTool();
  const [jsonMode, setJsonMode] = useState(false);
  const [fields, setFields] = useState<Record<string, any>>({});
  const [argsJson, setArgsJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [executeAs, setExecuteAs] = useState('');

  useEffect(() => {
    const skeleton = buildSkeleton(tool.inputSchema);
    setFields(skeleton);
    setArgsJson(JSON.stringify(skeleton, null, 2));
    setJsonMode(false);
    setJsonError('');
    callTool.reset();
  }, [tool.name, serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasResult = !!callTool.data || !!callTool.error;

  const toggleMode = () => {
    if (!jsonMode) {
      setArgsJson(JSON.stringify(fields, null, 2));
    } else {
      try { setFields(JSON.parse(argsJson)); } catch { /* keep fields */ }
    }
    setJsonMode(!jsonMode);
  };

  const handleRun = () => {
    setJsonError('');
    callTool.reset();
    let parsed: Record<string, unknown>;
    if (jsonMode) {
      try { parsed = JSON.parse(argsJson); } catch { setJsonError('Invalid JSON'); return; }
    } else {
      parsed = { ...fields };
    }
    callTool.mutate({
      serverId,
      toolName: tool.name,
      arguments: parsed,
      ...(executeAs ? { execute_as: executeAs } : {}),
    });
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
        <RunAsSelector selected={executeAs} onChange={setExecuteAs} />

        {tool.description && (
          <p className="text-[11px] text-text-secondary leading-relaxed">{tool.description}</p>
        )}

        {/* Form / JSON toggle input */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Request</label>
            <button onClick={toggleMode} className="text-[10px] text-accent hover:underline">
              {jsonMode ? 'Form view' : 'JSON view'}
            </button>
          </div>

          {jsonMode ? (
            <textarea
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary resize-y"
              rows={6}
              spellCheck={false}
            />
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {Object.entries(fields).map(([key, value]) => (
                <div key={key}>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">{key}</label>
                  {typeof value === 'boolean' ? (
                    <select
                      value={String(value)}
                      onChange={(e) => setFields({ ...fields, [key]: e.target.value === 'true' })}
                      className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : typeof value === 'object' ? (
                    <textarea
                      value={JSON.stringify(value, null, 2)}
                      onChange={(e) => { try { setFields({ ...fields, [key]: JSON.parse(e.target.value) }); } catch { /* invalid */ } }}
                      className="w-full min-h-[60px] px-3 py-1.5 bg-surface-sunken border border-surface-border rounded-md font-mono text-xs text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                    />
                  ) : (
                    <input
                      type={typeof value === 'number' ? 'number' : 'text'}
                      value={String(value ?? '')}
                      onChange={(e) => setFields({ ...fields, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}
                      className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                    />
                  )}
                </div>
              ))}
              {Object.keys(fields).length === 0 && (
                <p className="text-[11px] text-text-tertiary italic">No input fields defined</p>
              )}
            </div>
          )}
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
