import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useSetYamlCron, useClearYamlCron } from '../../../api/yaml-workflows';
import { RunAsSelector } from '../form/RunAsSelector';
import { CronScheduleEditor } from '../../../pages/workflows/cron/CronScheduleEditor';
import { SectionLabel } from '../layout/SectionLabel';
import { buildSkeleton } from '../../../pages/mcp/mcp-query-detail/helpers';
import type { LTYamlWorkflowRecord } from '../../../api/types';

interface CronPanelProps {
  workflow: LTYamlWorkflowRecord;
  onClose: () => void;
}

export function CronPanel({ workflow, onClose }: CronPanelProps) {
  const setCronMutation = useSetYamlCron();
  const clearCronMutation = useClearYamlCron();

  const [cronInput, setCronInput] = useState('');
  const [executeAs, setExecuteAs] = useState('');
  const [jsonMode, setJsonMode] = useState(false);
  const [fields, setFields] = useState<Record<string, any>>({});
  const [argsJson, setArgsJson] = useState('{}');

  // Sync state when workflow changes
  useEffect(() => {
    setCronInput(workflow.cron_schedule ?? '');
    setExecuteAs(workflow.execute_as ?? '');
    setCronMutation.reset();
    clearCronMutation.reset();

    const envelope = workflow.cron_envelope || {};
    const skeleton = Object.keys(envelope).length > 0
      ? envelope
      : buildSkeleton(workflow.input_schema);
    setFields(skeleton as Record<string, any>);
    setArgsJson(JSON.stringify(skeleton, null, 2));
    setJsonMode(false);
  }, [workflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMode = () => {
    if (!jsonMode) {
      setArgsJson(JSON.stringify(fields, null, 2));
    } else {
      try { setFields(JSON.parse(argsJson)); } catch { /* keep fields */ }
    }
    setJsonMode(!jsonMode);
  };

  const handleSave = () => {
    let envelope: Record<string, unknown>;
    if (jsonMode) {
      try { envelope = JSON.parse(argsJson); } catch { return; }
    } else {
      envelope = { ...fields };
    }

    setCronMutation.mutate({
      id: workflow.id,
      cron_schedule: cronInput.trim(),
      cron_envelope: Object.keys(envelope).length > 0 ? envelope : null,
      execute_as: executeAs || null,
    });
  };

  const handleClear = () => {
    clearCronMutation.mutate(workflow.id, {
      onSuccess: () => {
        setCronInput('');
      },
    });
  };

  // Combine mutation states for CronScheduleEditor
  const combinedMutation = {
    isPending: setCronMutation.isPending || clearCronMutation.isPending,
    isSuccess: setCronMutation.isSuccess || clearCronMutation.isSuccess,
    error: setCronMutation.error || clearCronMutation.error,
    reset: () => { setCronMutation.reset(); clearCronMutation.reset(); },
  };

  return (
    <div className="border-l border-surface-border bg-surface-raised flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">Cron Schedule</p>
          <code className="text-[11px] font-mono text-accent truncate block">{workflow.graph_topic}</code>
        </div>
        <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary shrink-0 ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <RunAsSelector selected={executeAs} onChange={setExecuteAs} />

        <CronScheduleEditor
          cronInput={cronInput}
          setCronInput={setCronInput}
          setCron={combinedMutation}
          hasCronSchedule={!!workflow.cron_schedule}
          onSave={handleSave}
          onClear={handleClear}
        />

        {/* Default input for cron invocations */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <SectionLabel>Default Input</SectionLabel>
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
            <div className="space-y-3 max-h-[200px] overflow-y-auto">
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
        </div>
      </div>
    </div>
  );
}
