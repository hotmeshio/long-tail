import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Trash2, X } from 'lucide-react';
import { useHelpAssistant } from '../../hooks/useHelpAssistant';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';
import {
  type PanelSize,
  SIZE_CYCLE,
  SIZE_CLASSES,
  SIZE_LABELS,
  SizeIcon,
  ThinkingIndicator,
  MessageMeta,
} from './help-panel-messages';

export function HelpPanel() {
  const { helpOpen, setHelpOpen, messages, sendMessage, pageContext, activeWorkflowId, clearMessages, compileMessage } =
    useHelpAssistant();
  const [input, setInput] = useState('');
  const [size, setSize] = useState<PanelSize>('md');
  const [hovered, setHovered] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (helpOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [helpOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (size === 'full') setSize('lg');
        else if (size === 'lg') setSize('md');
        else if (size === 'md') setSize('sm');
        else setHelpOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [helpOpen, size, setHelpOpen]);

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
              title="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
          <button
            onClick={() => setHelpOpen(false)}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
            aria-label="Close"
            title="Close"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
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
            className={`text-xs leading-relaxed ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
          >
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
            {!msg.pending && (
              <div className="mt-0.5">
                <MessageMeta msg={msg} compileMessage={compileMessage} />
              </div>
            )}
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
