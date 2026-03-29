import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { PanelTitle } from './PanelTitle';
import { ResultSummary } from './ResultSummary';

interface OriginalQueryPanelProps {
  status: string;
  originalEnvelope: Record<string, unknown> | null;
  originalPrompt: string | undefined;
  originalOutput: unknown;
  originalDurationMs: number | null | undefined;
  resultSummary: string | undefined;
  onNext: () => void;
}

export function OriginalQueryPanel({
  status,
  originalEnvelope,
  originalPrompt,
  originalOutput,
  originalDurationMs,
  resultSummary,
  onNext,
}: OriginalQueryPanelProps) {
  return (
    <div>
      <PanelTitle title="Original MCP Query" subtitle="Dynamic LLM-orchestrated execution with MCP tools" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Input */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input</p>
          {originalEnvelope ? (
            <JsonViewer data={originalEnvelope} defaultMode="tree" />
          ) : originalPrompt ? (
            <JsonViewer data={{ prompt: originalPrompt }} defaultMode="tree" />
          ) : (
            <p className="text-xs text-text-tertiary italic">Loading...</p>
          )}
        </div>

        {/* Right: Output */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output</p>
          {status !== 'completed' && status !== 'failed' ? (
            <p className="text-sm text-text-secondary animate-pulse">Pending...</p>
          ) : originalOutput ? (
            <JsonViewer data={originalOutput} defaultMode="tree" />
          ) : resultSummary ? (
            <ResultSummary text={resultSummary} />
          ) : (
            <p className="text-xs text-text-tertiary italic">No structured output</p>
          )}
          {originalDurationMs != null && (
            <p className="text-[10px] text-text-tertiary mt-2">{(originalDurationMs / 1000).toFixed(1)}s</p>
          )}
        </div>
      </div>

      <WizardNav><span /><button onClick={onNext} className="btn-primary text-xs">Next: Timeline</button></WizardNav>
    </div>
  );
}
