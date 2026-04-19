import { useState } from 'react';
import { Play, Loader2, CheckCircle, XCircle } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { useInvokeYamlWorkflow } from '../../../api/yaml-workflows';

interface TestPanelProps {
  yamlWorkflowId: string;
  sampleInputs?: Record<string, unknown>;
  onBack: () => void;
}

export function TestPanel({ yamlWorkflowId, sampleInputs, onBack }: TestPanelProps) {
  const [inputJson, setInputJson] = useState(
    sampleInputs ? JSON.stringify(sampleInputs, null, 2) : '{}',
  );
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const invokeMutation = useInvokeYamlWorkflow();

  const handleRun = async () => {
    setTestResult(null);
    setTestError(null);
    try {
      const data = JSON.parse(inputJson);
      const result = await invokeMutation.mutateAsync({
        id: yamlWorkflowId,
        data,
        sync: true,
      });
      setTestResult(result);
    } catch (err: any) {
      setTestError(err.message || 'Test execution failed');
    }
  };

  const hasResult = testResult !== null;
  const isRunning = invokeMutation.isPending;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Play className="w-4 h-4 text-accent" strokeWidth={1.5} />
        <h2 className="text-sm font-semibold text-text-primary">Test</h2>
      </div>
      <p className="text-xs text-text-tertiary mb-6">
        Run the deployed workflow with test inputs and inspect results.
      </p>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input</p>
          <textarea
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            className="w-full min-h-[200px] px-3 py-2 bg-surface text-xs font-mono text-text-primary rounded-md border border-surface-border resize-none focus:outline-none focus:ring-1 focus:ring-accent"
            spellCheck={false}
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {isRunning ? 'Running...' : 'Run Test'}
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output</p>
          {isRunning && (
            <div className="flex items-center gap-2 py-8 justify-center text-text-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Executing workflow...</span>
            </div>
          )}

          {testError && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-status-error/5 border border-status-error/20">
              <XCircle className="w-4 h-4 text-status-error shrink-0 mt-0.5" />
              <p className="text-xs text-status-error">{testError}</p>
            </div>
          )}

          {hasResult && !testError && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle className="w-3.5 h-3.5 text-status-success" />
                <span className="text-xs text-status-success font-medium">Execution complete</span>
              </div>
              <div className="rounded-md border border-surface-border bg-surface-raised p-3 max-h-[300px] overflow-y-auto">
                <JsonViewer data={testResult} />
              </div>
            </div>
          )}

          {!isRunning && !hasResult && !testError && (
            <div className="py-8 text-center text-xs text-text-tertiary">
              Run a test to see results
            </div>
          )}
        </div>
      </div>

      <WizardNav>
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          &larr; Deploy
        </button>
        <div />
      </WizardNav>
    </div>
  );
}
