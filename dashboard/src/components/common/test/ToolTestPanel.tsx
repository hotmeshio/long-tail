import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, RotateCcw, Play, ExternalLink, KeyRound } from 'lucide-react';
import { useCallMcpTool } from '../../../api/mcp';
import { JsonViewer } from '../data/JsonViewer';
import { RunAsSelector } from '../form/RunAsSelector';
import { ToolPill } from '../display/ToolPill';
import { ServerName } from '../display/ServerName';
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
  const ns = res?.namespace || '';
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

const INPUT_CLS = 'input text-xs';
const LABEL_CLS = 'label';

/** Text input for array fields — commits on blur or Enter, allows commas while typing */
function ArrayInput({ value, onChange, className }: { value: any[]; onChange: (v: string[]) => void; className: string }) {
  const [raw, setRaw] = useState(value.join(', '));
  const commit = () => onChange(raw.split(',').map((s) => s.trim()).filter(Boolean));
  // Sync if parent value changes externally
  useEffect(() => { setRaw(value.join(', ')); }, [JSON.stringify(value)]); // eslint-disable-line
  return (
    <input
      type="text"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      placeholder="comma-separated values"
      className={className}
    />
  );
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
    <div className="border-l border-surface-border bg-surface-raised">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-surface-border/50 shrink-0">
        <div className="min-w-0 space-y-1">
          <ServerName name={serverName} serverId={serverId} short={false} />
          <div><ToolPill name={tool.name} size="md" /></div>
        </div>
        <button onClick={onClose} className="p-1 text-text-quaternary hover:text-text-primary shrink-0 ml-2">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="px-4 py-4 space-y-5">
        {tool.description && (
          <div className="border-l-2 border-accent/30 pl-3 py-1">
            <p className="text-[11px] text-text-secondary leading-relaxed italic">{tool.description}</p>
          </div>
        )}

        {/* Run as */}
        <div>
          <label className={LABEL_CLS}>run as</label>
          <RunAsSelector selected={executeAs} onChange={setExecuteAs} />
        </div>

        {/* Form / JSON toggle input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-text-quaternary">Parameters</span>
            <button onClick={toggleMode} className="text-[10px] text-accent/70 hover:text-accent transition-colors">
              {jsonMode ? 'Form view' : 'JSON view'}
            </button>
          </div>

          {jsonMode ? (
            <textarea
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              className="input-json w-full"
              rows={6}
              spellCheck={false}
            />
          ) : (
            <div className="space-y-3">
              {Object.entries(fields).sort(([a], [b]) => {
                const req = (tool.inputSchema?.required ?? []) as string[];
                const ai = req.indexOf(a);
                const bi = req.indexOf(b);
                if (ai !== -1 && bi !== -1) return ai - bi;
                if (ai !== -1) return -1;
                if (bi !== -1) return 1;
                return a.localeCompare(b);
              }).map(([key, value]) => {
                const propSchema = tool.inputSchema?.properties?.[key];
                const hint = propSchema?.description;
                const isRequired = (tool.inputSchema?.required ?? []).includes(key);
                return (
                  <div key={key}>
                    <label className={LABEL_CLS}>
                      {key}
                      {isRequired && <span className="text-accent/50 ml-0.5">*</span>}
                    </label>
                    {typeof value === 'boolean' ? (
                      <select
                        value={String(value)}
                        onChange={(e) => setFields({ ...fields, [key]: e.target.value === 'true' })}
                        className={INPUT_CLS}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : Array.isArray(value) ? (
                      <ArrayInput
                        value={value as any[]}
                        onChange={(v) => setFields({ ...fields, [key]: v })}
                        className={INPUT_CLS}
                      />
                    ) : typeof value === 'object' && value !== null ? (
                      <textarea
                        value={JSON.stringify(value, null, 2)}
                        onChange={(e) => { try { setFields({ ...fields, [key]: JSON.parse(e.target.value) }); } catch { /* invalid */ } }}
                        className={`${INPUT_CLS} min-h-[48px] font-mono resize-y`}
                      />
                    ) : (
                      <input
                        type={typeof value === 'number' ? 'number' : 'text'}
                        value={String(value ?? '')}
                        onChange={(e) => setFields({ ...fields, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}
                        className={INPUT_CLS}
                        placeholder={propSchema?.type === 'string' ? propSchema?.example || '' : ''}
                      />
                    )}
                    {hint && <p className="text-[9px] text-text-quaternary/70 mt-0.5 leading-snug">{hint}</p>}
                  </div>
                );
              })}
              {Object.keys(fields).length === 0 && (
                <p className="text-[11px] text-text-quaternary">No parameters</p>
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
            <p className="text-[10px] text-text-quaternary mb-1">Response</p>
            <div className="h-20 bg-surface-sunken/50 rounded-md" />
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
            <p className="text-[10px] text-text-quaternary mb-1">Response</p>
            <ToolErrorDisplay error={callTool.error as Error | null} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
