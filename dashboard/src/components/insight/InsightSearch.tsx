import { useState, useRef, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useInsightQuery, useLastInsightQuestion } from '../../api/insight';
import { InsightModal } from './InsightModal';

const SUGGESTIONS = [
  'Which workflow types have the most escalations?',
  'Show me all escalated processes',
  'What is the current workload by role?',
  'How many tasks completed in the last 24 hours?',
  'Summarize today\'s activity',
  'Trace the most recent failed task — what happened in the workflow execution?',
];

export function InsightSearch() {
  const lastQuestion = useLastInsightQuestion();
  const [input, setInput] = useState('');
  const [activeQuestion, setActiveQuestion] = useState<string | null>(lastQuestion);
  const [modalOpen, setModalOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data, isFetching, error } = useInsightQuery(activeQuestion);

  // Open modal automatically when a query starts or has results
  useEffect(() => {
    if (isFetching || data || error) setModalOpen(true);
  }, [isFetching, data, error]);

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
    setActiveQuestion(trimmed);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <form onSubmit={handleSubmit} className="relative flex items-center">
          <Sparkles className="absolute left-2.5 w-3.5 h-3.5 text-accent/60 pointer-events-none" />
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setSuggestionsOpen(true); }}
            onFocus={() => setSuggestionsOpen(true)}
            placeholder="Which workflow types have the most escalations?"
            className="w-[22rem] pl-8 pr-3 py-1.5 rounded-md bg-surface-sunken border border-surface-border
                       text-[11px] text-text-primary placeholder:text-text-tertiary
                       focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent
                       transition-colors"
          />
        </form>

        {/* Suggestion dropdown */}
        {suggestionsOpen && !input.trim() && (
          <div className="absolute top-full left-0 mt-1 w-80 bg-surface-raised border border-surface-border rounded-md shadow-lg z-40 py-1">
            {SUGGESTIONS.map((s) => (
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
        data={data}
        isFetching={isFetching}
        error={error}
      />
    </>
  );
}
