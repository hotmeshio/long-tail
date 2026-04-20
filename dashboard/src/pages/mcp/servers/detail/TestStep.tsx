import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useTestConnection } from '../../../../api/mcp';
import type { ServerFormState } from './server-form-types';
import { formToPayload } from './server-form-types';
import { hintCls } from './server-form-types';

interface Props {
  form: ServerFormState;
  set: (field: keyof ServerFormState, value: any) => void;
}

export function TestStep({ form, set }: Props) {
  const test = useTestConnection();
  const isInProcess = form.mode === 'in-process';

  const handleTest = () => {
    const payload = formToPayload(form);
    test.mutate(
      { transport_type: payload.transport_type, transport_config: payload.transport_config },
      {
        onSuccess: (result) => {
          if (result.success) {
            set('discovered_tools', result.tools);
          }
        },
      },
    );
  };

  const result = test.data;
  const tools = form.discovered_tools ?? result?.tools ?? [];

  return (
    <div className="space-y-5">
      {isInProcess ? (
        <div>
          <p className="text-sm text-text-secondary">
            In-process servers connect lazily on first tool call. No connection test needed.
          </p>
          {form.discovered_tools && form.discovered_tools.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-text-tertiary mb-2">
                {form.discovered_tools.length} tool{form.discovered_tools.length !== 1 ? 's' : ''} cached from last connection
              </p>
              <ToolList tools={form.discovered_tools} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={test.isPending}
              className="btn-primary text-xs"
            >
              {test.isPending ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Connecting...
                </span>
              ) : (
                'Test Connection'
              )}
            </button>
            {result?.success && (
              <span className="flex items-center gap-1 text-xs text-status-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Connected — {tools.length} tool{tools.length !== 1 ? 's' : ''} discovered
              </span>
            )}
            {result && !result.success && (
              <span className="flex items-center gap-1 text-xs text-status-error">
                <XCircle className="w-3.5 h-3.5" />
                {result.error || 'Connection failed'}
              </span>
            )}
          </div>

          {tools.length > 0 && (
            <div>
              <p className="text-xs text-text-tertiary mb-2">Discovered tools</p>
              <ToolList tools={tools} />
            </div>
          )}

          <p className={hintCls}>
            Tests connectivity by connecting to the server and listing available tools. The server must be reachable from this machine.
          </p>
        </>
      )}
    </div>
  );
}

function ToolList({ tools }: { tools: { name: string; description?: string }[] }) {
  return (
    <div className="max-h-[280px] overflow-y-auto border border-surface-border rounded-md divide-y divide-surface-border">
      {tools.map((t) => (
        <div key={t.name} className="px-3 py-2">
          <span className="text-xs font-medium text-text-primary font-mono">{t.name}</span>
          {t.description && (
            <span className="block text-[10px] text-text-tertiary mt-0.5 line-clamp-2">{t.description}</span>
          )}
        </div>
      ))}
    </div>
  );
}
