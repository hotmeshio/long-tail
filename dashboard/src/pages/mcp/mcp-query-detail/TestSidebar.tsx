import { RunAsSelector } from '../../../components/common/form/RunAsSelector';
import { LiveActivityTimeline } from './LiveActivityTimeline';
import type { ActivityManifestEntry } from '../../../api/types';
import type { ActivityStep } from '../../../hooks/useYamlActivityEvents';

interface TestSidebarProps {
  sidebarOpen: boolean;
  activeJobId: string | null;
  activitySteps: ActivityStep[];
  activityManifest: ActivityManifestEntry[] | undefined;
  jobComplete: boolean;
  invokeJsonMode: boolean;
  setInvokeJsonMode: (v: boolean) => void;
  invokeJson: string;
  setInvokeJson: (v: string) => void;
  invokeFields: Record<string, any>;
  setInvokeFields: (v: Record<string, any>) => void;
  executeAs: string;
  setExecuteAs: (v: string) => void;
  invokeError: string | undefined;
  invokePending: boolean;
  onInvoke: () => void;
  onClose: () => void;
}

export function TestSidebar({
  sidebarOpen,
  activeJobId,
  activitySteps,
  activityManifest,
  jobComplete,
  invokeJsonMode,
  setInvokeJsonMode,
  invokeJson,
  setInvokeJson,
  invokeFields,
  setInvokeFields,
  executeAs,
  setExecuteAs,
  invokeError,
  invokePending,
  onInvoke,
  onClose,
}: TestSidebarProps) {
  if (!sidebarOpen && !activeJobId) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-text-tertiary">Click "Run Test" to invoke the compiled pipeline</p>
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeIn 300ms ease-out both' }}>
      {activeJobId ? (
        /* Live execution timeline */
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Execution</p>
          <LiveActivityTimeline
            steps={activitySteps}
            manifest={activityManifest ?? []}
            isComplete={jobComplete}
          />
        </div>
      ) : (
        /* Input form */
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Test Inputs</p>
            <button onClick={() => {
              if (!invokeJsonMode) setInvokeJson(JSON.stringify(invokeFields, null, 2));
              else try { setInvokeFields(JSON.parse(invokeJson)); } catch { /* keep fields */ }
              setInvokeJsonMode(!invokeJsonMode);
            }} className="text-[10px] text-accent hover:underline">
              {invokeJsonMode ? 'Form view' : 'JSON view'}
            </button>
          </div>

          <RunAsSelector selected={executeAs} onChange={setExecuteAs} />

          <div className="mt-3">
          {invokeJsonMode ? (
            <textarea
              value={invokeJson}
              onChange={(e) => setInvokeJson(e.target.value)}
              className="w-full min-h-[200px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md font-mono text-xs text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
            />
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {Object.entries(invokeFields).map(([key, value]) => (
                <div key={key}>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">{key}</label>
                  {typeof value === 'boolean' ? (
                    <select
                      value={String(value)}
                      onChange={(e) => setInvokeFields({ ...invokeFields, [key]: e.target.value === 'true' })}
                      className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : typeof value === 'object' ? (
                    <textarea
                      value={JSON.stringify(value, null, 2)}
                      onChange={(e) => { try { setInvokeFields({ ...invokeFields, [key]: JSON.parse(e.target.value) }); } catch { /* invalid json */ } }}
                      className="w-full min-h-[60px] px-3 py-1.5 bg-surface-sunken border border-surface-border rounded-md font-mono text-xs text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                    />
                  ) : (
                    <input
                      type={typeof value === 'number' ? 'number' : 'text'}
                      value={String(value ?? '')}
                      onChange={(e) => setInvokeFields({ ...invokeFields, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}
                      className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          </div>

          {invokeError && (
            <p className="mt-2 text-xs text-status-error">{invokeError}</p>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
            <button onClick={onInvoke} disabled={invokePending} className="btn-primary text-xs">
              {invokePending ? 'Starting...' : 'Invoke'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
