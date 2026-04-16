import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { useHelpAssistant } from '../../hooks/useHelpAssistant';
import { SimpleMarkdown } from '../common/display/SimpleMarkdown';
import { DateValue } from '../common/display/DateValue';

export function HelpPanel() {
  const { helpOpen, messages, sendMessage, pageContext, activeWorkflowId, clearMessages } =
    useHelpAssistant();
  const [input, setInput] = useState('');
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

  if (!helpOpen) return null;

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || activeWorkflowId) return;
    sendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const pageName = pageContext.page.replace(/-/g, ' ');

  return (
    <div
      className="fixed right-6 z-[45] w-[32rem] max-h-[60vh] flex flex-col bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden transition-all duration-200"
      style={{
        bottom: 'calc(var(--feed-height, 32px) + 76px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-border">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">Help Assistant</p>
          <p className="text-[10px] text-text-tertiary truncate">{pageName}</p>
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[120px]">
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
              <div className={`mb-0.5 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <DateValue
                  date={msg.timestamp}
                  format="time"
                  className="!text-[9px] text-text-muted/50"
                />
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
                <span className="inline-flex items-center gap-1">
                  <span className="text-text-tertiary">Thinking</span>
                  <span className="inline-block w-1 h-1 rounded-full bg-text-tertiary animate-pulse" />
                  <span className="inline-block w-1 h-1 rounded-full bg-text-tertiary animate-pulse [animation-delay:150ms]" />
                  <span className="inline-block w-1 h-1 rounded-full bg-text-tertiary animate-pulse [animation-delay:300ms]" />
                </span>
              ) : msg.role === 'assistant' ? (
                <SimpleMarkdown content={msg.content} compact />
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-surface-border px-3 py-2.5 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question..."
          rows={1}
          className="flex-1 resize-none bg-surface text-xs text-text-primary placeholder:text-text-tertiary rounded px-2.5 py-1.5 border border-surface-border focus:outline-none focus:border-accent"
          disabled={!!activeWorkflowId}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || !!activeWorkflowId}
          className="px-2.5 py-1.5 text-accent hover:text-accent-hover disabled:text-text-muted transition-colors"
          aria-label="Send"
        >
          <Send className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
