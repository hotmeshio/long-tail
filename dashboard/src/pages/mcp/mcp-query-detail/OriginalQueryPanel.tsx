import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { SwimlaneTimeline } from '../../workflows/workflow-execution/SwimlaneTimeline';
import { PanelTitle } from './PanelTitle';
import { ResultSummary } from './ResultSummary';

interface OriginalQueryPanelProps {
  status: string;
  events: any[];
  originalEnvelope: Record<string, unknown> | null;
  originalPrompt: string | undefined;
  originalOutput: unknown;
  originalDurationMs: number | null | undefined;
  resultSummary: string | undefined;
  onNext: () => void;
}

export function OriginalQueryPanel({
  status,
  events,
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

      {status === 'in_progress' && events.length > 0 && <SwimlaneTimeline events={events} />}
      {status === 'in_progress' && events.length === 0 && <p className="text-sm text-text-secondary animate-pulse">Starting query...</p>}

      {status === 'completed' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Input */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input</p>
            {originalEnvelope ? (
              <JsonViewer data={originalEnvelope} defaultMode="tree" />
            ) : originalPrompt ? (
              <p className="text-xs text-text-primary leading-relaxed px-3 py-2 bg-surface-sunken rounded-md">{originalPrompt}</p>
            ) : (
              <p className="text-xs text-text-tertiary italic">Loading...</p>
            )}
          </div>

          {/* Right: Output */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output</p>
            {originalOutput ? (
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
      )}

      {status === 'completed' && (
        <WizardNav><span /><button onClick={onNext} className="btn-primary text-xs">Next: Timeline</button></WizardNav>
      )}
    </div>
  );
}
