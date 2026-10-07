import type { ScanResult } from '../../hooks/useScanInput';
import { OUTCOME_TONE, outcomeHeadline, outcomeMarkdown } from './outcome-display';
import { SimpleMarkdown } from '../common/display/SimpleMarkdown';

/**
 * The narration of one scan result: the code, the outcome headline in its
 * status tone, the server's detail line, and any fallback markdown. Shared by
 * the panel, the toast, and the header bar so every surface tells it alike.
 */
export function ScanOutcomeBody({ result, compact = false }: { result: ScanResult; compact?: boolean }) {
  const { response } = result;
  const text = compact ? 'text-xs' : 'text-sm';
  const markdown = response ? outcomeMarkdown(response) : null;
  // A refusal's error is its markdown; show it once, rendered.
  const detail = response?.error && response.error !== markdown ? response.error : null;
  return (
    <div className="min-w-0">
      <div className={`${text} font-mono text-text-secondary truncate`}>{result.code}</div>
      {response ? (
        <>
          <div className={`${text} font-medium ${OUTCOME_TONE[response.outcome]}`}>
            {outcomeHeadline(response)}
          </div>
          {detail && <div className="text-xs text-text-tertiary mt-0.5">{detail}</div>}
          {markdown && (
            <div className="text-xs text-text-secondary mt-1.5">
              <SimpleMarkdown content={markdown} compact />
            </div>
          )}
        </>
      ) : (
        <div className={`${text} text-status-error`}>{result.error}</div>
      )}
    </div>
  );
}
