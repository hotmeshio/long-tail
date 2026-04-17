import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Send, Trash2, Workflow, GraduationCap } from 'lucide-react';
import { useHelpAssistant, type HelpMessage } from '../../hooks/useHelpAssistant';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';
import { DateValue } from '../common/display/DateValue';
import { DurationValue } from '../common/display/DurationValue';

type PanelSize = 'sm' | 'md' | 'lg' | 'full';
const SIZE_CYCLE: PanelSize[] = ['sm', 'md', 'lg', 'full'];

const SIZE_CLASSES: Record<PanelSize, string> = {
  sm:   'w-[28rem] max-h-[40vh]',
  md:   'w-[36rem] max-h-[60vh]',
  lg:   'w-[48rem] max-h-[80vh]',
  full: 'inset-4 w-auto max-h-none',
};

const SIZE_LABELS: Record<PanelSize, string> = {
  sm: 'Small', md: 'Medium', lg: 'Large', full: 'Fullscreen',
};

function SizeIcon({ which }: { which: PanelSize }) {
  const cls = 'stroke-current';
  // Progressively larger rounded rects — all 14x14 viewBox, 1.5 stroke
  switch (which) {
    case 'sm':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="5" y="5" width="7" height="7" rx="1.5" className={cls} strokeWidth="1.5" />
        </svg>
      );
    case 'md':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="3" y="3" width="9" height="9" rx="1.5" className={cls} strokeWidth="1.5" />
        </svg>
      );
    case 'lg':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" className={cls} strokeWidth="1.5" />
        </svg>
      );
    case 'full':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="1.5" className={cls} strokeWidth="1.5" />
        </svg>
      );
  }
}

function ThinkingIndicator({ msg }: { msg: HelpMessage }) {
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

export function HelpPanel() {
  const { helpOpen, messages, sendMessage, pageContext, activeWorkflowId, clearMessages, compileMessage } =
    useHelpAssistant();
  const [input, setInput] = useState('');
  const [size, setSize] = useState<PanelSize>('md');
  const [hovered, setHovered] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (helpOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [helpOpen]);

  // Escape to shrink or close
  useEffect(() => {
    if (!helpOpen) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (size === 'full') setSize('lg');
        else if (size === 'lg') setSize('md');
        else if (size === 'md') setSize('sm');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [helpOpen, size]);

  if (!helpOpen) return null;

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || activeWorkflowId) return;
    sendMessage(trimmed);
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isFull = size === 'full';
  const pageName = pageContext.page.replace(/-/g, ' ');

  const positionStyle = isFull
    ? {}
    : { bottom: 'calc(var(--feed-height, 32px) + 76px)' };

  return (
    <div
      className={`fixed z-[45] flex flex-col border border-surface-border rounded-lg overflow-hidden transition-all duration-300 ${
        isFull ? SIZE_CLASSES.full : `right-6 ${SIZE_CLASSES[size]}`
      } ${
        hovered
          ? 'bg-surface-raised shadow-xl'
          : 'bg-surface-raised/[0.03] shadow-lg shadow-black/5'
      }`}
      style={positionStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-surface-border shrink-0 transition-all duration-300 ${
        hovered ? 'opacity-100' : 'opacity-50 grayscale brightness-150'
      }`}>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-primary truncate">Help Assistant</p>
          <p className="text-[10px] text-text-tertiary truncate">{pageName}</p>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <div className="flex items-center gap-0.5 border border-surface-border rounded p-0.5" role="radiogroup" aria-label="Panel size">
            {SIZE_CYCLE.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`p-1 rounded transition-colors ${
                  s === size
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                }`}
                role="radio"
                aria-checked={s === size}
                aria-label={SIZE_LABELS[s]}
                title={SIZE_LABELS[s]}
              >
                <SizeIcon which={s} />
              </button>
            ))}
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-1 text-text-tertiary hover:text-text-secondary transition-colors"
              aria-label="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className={`flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[120px] transition-all duration-300 ${
        hovered ? 'opacity-100' : 'opacity-50 grayscale brightness-150'
      }`}>
        {messages.length === 0 && (
          <p className="text-xs text-text-tertiary text-center py-6">
            Ask anything about what you're viewing.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'text-right'
                : 'text-left'
            }`}
          >
            {!msg.pending && (
              <div className={`mb-0.5 flex items-center gap-1.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <DateValue
                  date={msg.timestamp}
                  format="time"
                  className="!text-[9px] text-text-muted/50"
                />
                {msg.workflowId && (
                  <Link
                    to={`/workflows/executions/${msg.workflowId}`}
                    className="text-accent/40 hover:text-accent transition-colors"
                    title="View workflow execution"
                  >
                    <Workflow className="w-2.5 h-2.5" strokeWidth={1.5} />
                  </Link>
                )}
                {msg.durationMs != null && (
                  <DurationValue ms={msg.durationMs} className="!text-[9px] text-text-muted/50" />
                )}
                {msg.role === 'assistant' && msg.workflowId && !msg.pending && (
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
                              : 'text-accent/40 hover:text-accent'
                      }`}
                      strokeWidth={1.5}
                    />
                  </button>
                )}
              </div>
            )}
            <div
              className={`inline-block max-w-[85%] px-3 py-2 rounded-md whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-accent/10 text-text-primary'
                  : 'bg-surface-sunken text-text-secondary'
              }`}
            >
              {msg.pending ? (
                <ThinkingIndicator msg={msg} />
              ) : msg.role === 'assistant' ? (
                <MarkdownRenderer content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className={`border-t border-surface-border px-3 py-2.5 flex gap-2 shrink-0 transition-all duration-300 ${
        hovered ? 'opacity-100' : 'opacity-50 grayscale brightness-150'
      }`}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question..."
          rows={2}
          className="flex-1 resize-none bg-surface text-xs text-text-primary placeholder:text-text-tertiary rounded px-2.5 py-1.5 border border-surface-border focus:outline-none focus:border-accent"
          style={{ minHeight: '2.5rem' }}
          disabled={!!activeWorkflowId}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || !!activeWorkflowId}
          className="px-2.5 py-1.5 text-accent hover:text-accent-hover disabled:text-text-muted transition-colors self-end"
          aria-label="Send"
        >
          <Send className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
