import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Workflow, GraduationCap } from 'lucide-react';
import type { HelpMessage } from '../../hooks/useHelpAssistant';
import { DateValue } from '../common/display/DateValue';
import { DurationValue } from '../common/display/DurationValue';

// ── Size types and constants ────────────────────────────────────────────────

export type PanelSize = 'sm' | 'md' | 'lg' | 'full';
export const SIZE_CYCLE: PanelSize[] = ['sm', 'md', 'lg', 'full'];

export const SIZE_CLASSES: Record<PanelSize, string> = {
  sm:   'w-[28rem] max-h-[40vh]',
  md:   'w-[36rem] max-h-[60vh]',
  lg:   'w-[48rem] max-h-[80vh]',
  full: 'inset-4 w-auto max-h-none',
};

export const SIZE_LABELS: Record<PanelSize, string> = {
  sm: 'Small', md: 'Medium', lg: 'Large', full: 'Fullscreen',
};

// ── Size icon ───────────────────────────────────────────────────────────────

export function SizeIcon({ which }: { which: PanelSize }) {
  const cls = 'stroke-current';
  switch (which) {
    case 'sm':
      return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="5" y="5" width="7" height="7" rx="1.5" className={cls} strokeWidth="1.5" /></svg>);
    case 'md':
      return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="9" height="9" rx="1.5" className={cls} strokeWidth="1.5" /></svg>);
    case 'lg':
      return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" className={cls} strokeWidth="1.5" /></svg>);
    case 'full':
      return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="1.5" className={cls} strokeWidth="1.5" /></svg>);
  }
}

// ── Thinking indicator ──────────────────────────────────────────────────────

export function ThinkingIndicator({ msg }: { msg: HelpMessage }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(msg.timestamp).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [msg.timestamp]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <span className="inline-flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1">
        <span className="text-text-tertiary">Thinking</span>
        <span className="inline-block w-1 h-1 rounded-full bg-text-tertiary animate-pulse" />
        <span className="inline-block w-1 h-1 rounded-full bg-text-tertiary animate-pulse [animation-delay:150ms]" />
        <span className="inline-block w-1 h-1 rounded-full bg-text-tertiary animate-pulse [animation-delay:300ms]" />
        <span className="text-text-muted ml-1 tabular-nums">{timeStr}</span>
      </span>
      {msg.workflowId && (
        <Link
          to={`/workflows/executions/${msg.workflowId}`}
          className="inline-flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent transition-colors"
        >
          <Workflow className="w-2.5 h-2.5" strokeWidth={1.5} />
          watch execution
        </Link>
      )}
    </span>
  );
}

// ── Message metadata row ────────────────────────────────────────────────────

export function MessageMeta({ msg, compileMessage }: { msg: HelpMessage; compileMessage: (id: string) => void }) {
  const isAssistant = msg.role === 'assistant';
  return (
    <div className={`flex items-center gap-1.5 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <DateValue date={msg.timestamp} format="time" className="!text-[9px] text-text-muted/50" />
      {msg.durationMs != null && (
        <>
          <span className="text-text-muted/30 text-[8px]">&middot;</span>
          <DurationValue ms={msg.durationMs} className="!text-[9px] text-text-muted/50" />
        </>
      )}
      {msg.workflowId && (
        <Link
          to={`/workflows/executions/${msg.workflowId}`}
          className="text-text-muted/40 hover:text-accent transition-colors"
          title="View workflow execution"
        >
          <Workflow className="w-2.5 h-2.5" strokeWidth={1.5} />
        </Link>
      )}
      {isAssistant && msg.workflowId && !msg.pending && (
        <button
          onClick={() => compileMessage(msg.id)}
          disabled={msg.compilationStatus === 'compiling' || msg.compilationStatus === 'done'}
          className="transition-colors"
          title={
            msg.compilationStatus === 'done'
              ? 'Compiled — future queries will match this pipeline'
              : msg.compilationStatus === 'error'
                ? msg.compilationError ?? 'Compilation failed'
                : msg.compilationStatus === 'compiling'
                  ? 'Compiling...'
                  : 'Compile to fast pipeline'
          }
        >
          <GraduationCap
            className={`w-2.5 h-2.5 ${
              msg.compilationStatus === 'done'
                ? 'text-status-success'
                : msg.compilationStatus === 'error'
                  ? 'text-status-error'
                  : msg.compilationStatus === 'compiling'
                    ? 'text-accent/40 animate-pulse'
                    : 'text-text-muted/40 hover:text-accent'
            }`}
            strokeWidth={1.5}
          />
        </button>
      )}
    </div>
  );
}
