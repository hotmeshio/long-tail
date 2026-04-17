import type { ServerFormState } from './server-form-types';
import { labelCls } from './server-form-types';

interface Props {
  form: ServerFormState;
}

const modeLabels: Record<string, string> = {
  'in-process': 'In-Process',
  'network': 'Network Service',
  'local-process': 'Local Process',
};

const transportLabels: Record<string, string> = {
  stdio: 'stdio',
  sse: 'SSE',
  'streamable-http': 'Streamable HTTP',
};

export function ReviewStep({ form }: Props) {
  const tools = form.discovered_tools ?? [];

  return (
    <div className="space-y-4">
      <Row label="Name" value={form.name} />
      {form.description && <Row label="Description" value={form.description} />}
      <Row label="Mode" value={modeLabels[form.mode] ?? form.mode} />

      {form.mode === 'network' && (
        <>
          <Row label="Transport" value={transportLabels[form.transport_type] ?? form.transport_type} />
          <Row label="URL" value={form.url} mono />
        </>
      )}
      {form.mode === 'local-process' && (
        <>
          <Row label="Command" value={form.command} mono />
          {form.args && <Row label="Args" value={form.args} mono />}
        </>
      )}

      <Row label="Auto-connect" value={form.auto_connect ? 'Yes' : 'No'} />

      {form.tags.length > 0 && (
        <div>
          <label className={labelCls}>Tags</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {form.tags.map((t) => (
              <span key={t} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-medium">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {form.credential_providers.length > 0 && (
        <div>
          <label className={labelCls}>Credential Providers</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {form.credential_providers.map((p) => (
              <span key={p} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-medium">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {form.compile_hints && <Row label="Compile Hints" value={form.compile_hints} />}

      {tools.length > 0 && (
        <Row label="Discovered Tools" value={`${tools.length} tool${tools.length !== 1 ? 's' : ''}`} />
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <p className={`text-xs text-text-primary mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}
