import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { describeCron, COMMON_PATTERNS } from './helpers';

interface CronScheduleEditorProps {
  cronInput: string;
  setCronInput: (value: string) => void;
  setCron: { isPending: boolean; isSuccess: boolean; error: Error | null; reset: () => void };
  hasCronSchedule: boolean;
  onSave: () => void;
  onClear: () => void;
}

export function CronScheduleEditor({
  cronInput,
  setCronInput,
  setCron,
  hasCronSchedule,
  onSave,
  onClear,
}: CronScheduleEditorProps) {
  return (
    <>
      <div>
        <SectionLabel className="mb-3">Schedule</SectionLabel>
        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <input
              type="text"
              value={cronInput}
              onChange={(e) => {
                setCronInput(e.target.value);
                setCron.reset();
              }}
              placeholder="0 */6 * * *"
              className="input font-mono text-sm w-full"
            />
            {cronInput.trim() && describeCron(cronInput.trim()) && (
              <p className="text-xs text-text-secondary mt-1.5">
                {describeCron(cronInput.trim())}
              </p>
            )}
          </div>
          <button
            onClick={onSave}
            disabled={setCron.isPending}
            className="btn-primary text-xs shrink-0"
          >
            {setCron.isPending ? 'Saving...' : 'Save'}
          </button>
          {hasCronSchedule && (
            <button
              onClick={onClear}
              disabled={setCron.isPending}
              className="btn-ghost text-xs text-status-error shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        {setCron.isSuccess && (
          <p className="text-[10px] text-status-success mt-2">Schedule updated</p>
        )}
        {setCron.error && (
          <p className="text-[10px] text-status-error mt-2">{setCron.error.message}</p>
        )}
      </div>

      {/* Common patterns */}
      <div className="bg-surface-sunken rounded-lg p-4">
        <SectionLabel className="mb-2">Common Patterns</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
          {COMMON_PATTERNS.map(([expr, desc]) => (
            <button
              key={expr}
              type="button"
              onClick={() => {
                setCronInput(expr);
                setCron.reset();
              }}
              className="flex items-center gap-2 text-left py-0.5 group"
            >
              <code className="font-mono text-[11px] text-accent group-hover:text-accent-hover">
                {expr}
              </code>
              <span className="text-[10px] text-text-tertiary">{desc}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
