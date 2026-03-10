import { useState, useRef, useEffect } from 'react';
import { Sparkles, Play } from 'lucide-react';
import {
  useInsightQuery,
  useMcpQuery,
  useLastInsightQuestion,
  useLastMcpQueryPrompt,
} from '../../api/insight';
import type { QueryMode } from '../../api/insight';
import { InsightModal } from './InsightModal';

const ASK_SUGGESTIONS = [
  'Which workflow types have the most escalations?',
  'Show me all escalated processes',
  'What is the current workload by role?',
  'How many tasks completed in the last 24 hours?',
  'Summarize today\'s activity',
  'Trace the most recent failed task — what happened in the workflow execution?',
];

const DO_SUGGESTIONS = [
  'Take a screenshot of https://example.com and save to file storage',
  'Fetch https://api.github.com/zen and save the response to /notes/zen.txt',
  'List all files in storage',
  'Find all pending escalations and summarize by role',
  'Navigate to https://news.ycombinator.com, screenshot, and save as /screenshots/hn.png',
  'Check system health and write a summary report to /reports/health.txt',
];

export function InsightSearch() {
  const lastQuestion = useLastInsightQuestion();
  const lastPrompt = useLastMcpQueryPrompt();

  const [mode, setMode] = useState<QueryMode>('ask');
  const [input, setInput] = useState('');
  const [activeQuestion, setActiveQuestion] = useState<string | null>(lastQuestion);
  const [activePrompt, setActivePrompt] = useState<string | null>(lastPrompt);
  const [modalOpen, setModalOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const insight = useInsightQuery(activeQuestion);
  const mcpQuery = useMcpQuery(activePrompt);

  const current = mode === 'ask' ? insight : mcpQuery;

  // Open modal automatically when a query starts or has results
  useEffect(() => {
    if (current.isFetching || current.data || current.error) setModalOpen(true);
  }, [current.isFetching, current.data, current.error]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setInput('');
    setSuggestionsOpen(false);
    if (mode === 'ask') {
      setActiveQuestion(trimmed);
    } else {
      setActivePrompt(trimmed);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  const suggestions = mode === 'ask' ? ASK_SUGGESTIONS : DO_SUGGESTIONS;
  const placeholder = mode === 'ask'
    ? 'Ask about system state...'
    : 'Do something with tools...';

  const Icon = mode === 'ask' ? Sparkles : Play;

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <form onSubmit={handleSubmit} className="relative flex items-center gap-1">
          {/* Mode toggle */}
          <div className="flex rounded-md border border-surface-border bg-surface-sunken overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setMode('ask')}
              className={`px-2 py-1.5 text-[10px] font-medium transition-colors ${
                mode === 'ask'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              Ask
            </button>
            <button
              type="button"
              onClick={() => setMode('do')}
              className={`px-2 py-1.5 text-[10px] font-medium transition-colors ${
                mode === 'do'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              Do
            </button>
          </div>

          {/* Input */}
          <div className="relative flex items-center">
            <Icon className="absolute left-2.5 w-3.5 h-3.5 text-accent/60 pointer-events-none" />
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setSuggestionsOpen(true); }}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder={placeholder}
              className="w-[22rem] pl-8 pr-3 py-1.5 rounded-md bg-surface-sunken border border-surface-border
                         text-[11px] text-text-primary placeholder:text-text-tertiary
                         focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent
                         transition-colors"
            />
          </div>
        </form>

        {/* Suggestion dropdown */}
        {suggestionsOpen && !input.trim() && (
          <div className="absolute top-full right-0 mt-1 w-96 bg-surface-raised border border-surface-border rounded-md shadow-lg z-40 py-1">
            <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">
              {mode === 'ask' ? 'Ask about your system' : 'Do something with tools'}
            </div>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="w-full text-left px-3 py-2 text-[11px] text-text-secondary
                           hover:bg-surface-hover transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <InsightModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={mode}
        data={current.data}
        isFetching={current.isFetching}
        error={current.error}
      />
    </>
  );
}
