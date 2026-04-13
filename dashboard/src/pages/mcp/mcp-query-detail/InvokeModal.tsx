import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Modal } from '../../../components/common/modal/Modal';
import { useInvokeYamlWorkflow } from '../../../api/yaml-workflows';
import { useYamlActivityEvents } from '../../../hooks/useYamlActivityEvents';
import { buildSkeleton } from '../../workflows/yaml-workflow-detail/helpers';
import type { ActivityManifestEntry } from '../../../api/types';
import { LiveActivityTimeline } from './LiveActivityTimeline';

interface InvokeModalProps {
  open: boolean;
  onClose: () => void;
  workflow: {
    id: string;
    name: string;
    input_schema: Record<string, unknown> | null;
    activity_manifest: ActivityManifestEntry[];
  };
  onJobCompleted: (jobId: string) => void;
}

export function InvokeModal({ open, onClose, workflow, onJobCompleted }: InvokeModalProps) {
  const queryClient = useQueryClient();
  const invokeMutation = useInvokeYamlWorkflow();

  const [invokeJsonMode, setInvokeJsonMode] = useState(false);
  const [invokeFields, setInvokeFields] = useState<Record<string, any>>({});
  const [invokeJson, setInvokeJson] = useState('{}');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const { steps: activitySteps, isComplete: jobComplete } = useYamlActivityEvents(activeJobId);

  useEffect(() => {
    if (workflow.input_schema) {
      const skeleton = buildSkeleton(workflow.input_schema);
      setInvokeFields(skeleton);
      setInvokeJson(JSON.stringify(skeleton, null, 2));
    }
  }, [workflow.id]);

  const handleInvoke = async () => {
    try {
      const data = invokeJsonMode ? JSON.parse(invokeJson) : invokeFields;
      const result = await invokeMutation.mutateAsync({ id: workflow.id, data, sync: false });
      if (result.job_id) {
        setActiveJobId(result.job_id);
      }
    } catch { /* error shown in modal */ }
  };

  useEffect(() => {
    if (jobComplete && activeJobId) {
      const completedJobId = activeJobId;
      const timer = setTimeout(() => {
        onClose();
        setActiveJobId(null);
        onJobCompleted(completedJobId);
        queryClient.invalidateQueries({ queryKey: ['mcpRuns'], refetchType: 'all' });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [jobComplete, activeJobId, queryClient]);

  return (
    <Modal
      open={open}
      onClose={() => { if (!activeJobId) { onClose(); } }}
      title={activeJobId ? 'Executing...' : 'Test Compiled Pipeline'}
      maxWidth="max-w-lg"
    >
      {activeJobId ? (
        <LiveActivityTimeline
          steps={activitySteps}
          manifest={workflow.activity_manifest}
          isComplete={jobComplete}
        />
      ) : (
        <>
          <p className="text-xs text-text-secondary mb-3 leading-relaxed">
            Invoke <span className="font-mono text-text-primary">{workflow.name}</span> with explicit inputs.
          </p>

          <div className="flex justify-end mb-2">
            <button onClick={() => {
              if (!invokeJsonMode) setInvokeJson(JSON.stringify(invokeFields, null, 2));
              else try { setInvokeFields(JSON.parse(invokeJson)); } catch { /* keep fields */ }
              setInvokeJsonMode(!invokeJsonMode);
            }} className="text-[10px] text-accent hover:underline">
              {invokeJsonMode ? 'Form view' : 'JSON view'}
            </button>
          </div>

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

          {invokeMutation.isError && (
            <p className="mt-2 text-xs text-status-error">{invokeMutation.error.message}</p>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
            <button onClick={handleInvoke} disabled={invokeMutation.isPending} className="btn-primary text-xs">
              {invokeMutation.isPending ? 'Starting...' : 'Invoke'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
