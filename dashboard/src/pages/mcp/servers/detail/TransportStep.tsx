import type { ServerFormState } from './server-form-types';
import { labelCls, hintCls } from './server-form-types';

interface Props {
  form: ServerFormState;
  set: (field: keyof ServerFormState, value: any) => void;
  isBuiltin: boolean;
}

const modes = [
  { value: 'in-process', label: 'In-Process', hint: 'Built-in server running inside the app' },
  { value: 'network', label: 'Network Service', hint: 'Remote server via SSE or Streamable HTTP' },
  { value: 'local-process', label: 'Local Process', hint: 'Spawn a local command via stdio' },
] as const;

export function TransportStep({ form, set, isBuiltin }: Props) {
  return (
    <div className="space-y-5">
      {/* Mode selector */}
      <div>
        <label className={labelCls}>Connection Mode</label>
        <div className="grid grid-cols-3 gap-3 mt-1">
          {modes.map((m) => {
            const active = form.mode === m.value;
            const disabled = isBuiltin && m.value !== 'in-process';
            return (
              <button
                key={m.value}
                type="button"
                disabled={disabled}
                onClick={() => {
                  set('mode', m.value);
                  if (m.value === 'local-process') set('transport_type', 'stdio');
                  if (m.value === 'network') set('transport_type', 'sse');
                }}
                className={`text-left p-3 rounded-md border transition-colors ${
                  active
                    ? 'border-accent bg-accent/5'
                    : disabled
                      ? 'border-surface-border bg-surface-sunken opacity-50 cursor-not-allowed'
                      : 'border-surface-border hover:border-text-tertiary cursor-pointer'
                }`}
              >
                <span className={`text-xs font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {m.label}
                </span>
                <span className="block text-[10px] text-text-tertiary mt-0.5">{m.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Name + Description (always shown) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g., vision-server"
            className="input text-xs w-full"
            disabled={isBuiltin}
          />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Optional description"
            className="input text-xs w-full"
          />
        </div>
      </div>

      {/* In-Process: read-only info */}
      {form.mode === 'in-process' && (
        <div>
          <p className={hintCls}>
            This server runs in-process via InMemoryTransport. Transport is managed automatically — no configuration needed.
          </p>
        </div>
      )}

      {/* Network: URL + transport toggle */}
      {form.mode === 'network' && (
        <>
          <div>
            <label className={labelCls}>Server URL</label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://mcp-server.example.com/sse"
              className="input text-xs w-full font-mono"
            />
          </div>
          <div>
            <label className={labelCls}>Transport Protocol</label>
            <div className="flex gap-2 mt-1">
              {(['sse', 'streamable-http'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('transport_type', t)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    form.transport_type === t
                      ? 'border-accent bg-accent/5 text-accent font-medium'
                      : 'border-surface-border text-text-secondary hover:border-text-tertiary'
                  }`}
                >
                  {t === 'sse' ? 'SSE' : 'Streamable HTTP'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Local Process: command + args + env */}
      {form.mode === 'local-process' && (
        <>
          <div>
            <label className={labelCls}>Command</label>
            <input
              type="text"
              value={form.command}
              onChange={(e) => set('command', e.target.value)}
              placeholder="e.g., npx"
              className="input text-xs w-full font-mono"
            />
          </div>
          <div>
            <label className={labelCls}>Arguments (comma-separated)</label>
            <input
              type="text"
              value={form.args}
              onChange={(e) => set('args', e.target.value)}
              placeholder="e.g., -y, @modelcontextprotocol/server-filesystem, /tmp"
              className="input text-xs w-full font-mono"
            />
          </div>
          <div>
            <label className={labelCls}>Environment Variables (JSON)</label>
            <textarea
              value={form.env_vars}
              onChange={(e) => set('env_vars', e.target.value)}
              className="input font-mono text-[11px] w-full leading-relaxed"
              rows={3}
              spellCheck={false}
            />
          </div>
        </>
      )}

      {/* Auto-connect */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.auto_connect}
          onChange={(e) => set('auto_connect', e.target.checked)}
          className="w-4 h-4 rounded border-border accent-accent"
        />
        <span className="text-xs text-text-primary">Auto-connect on startup</span>
      </label>
    </div>
  );
}
