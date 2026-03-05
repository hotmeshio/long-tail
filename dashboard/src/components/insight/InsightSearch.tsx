import { useState } from 'react';
import { useInsightQuery, useLastInsightQuestion } from '../../api/insight';
import { InsightResultCard } from './InsightResultCard';

const SUGGESTIONS = [
  'Show me all escalated processes',
  'What is the current workload by role?',
  'Summarize today\'s activity',
  'How many tasks completed in the last 24 hours?',
  'Which workflow types have the most escalations?',
  'Trace the most recent failed task — what happened in the workflow execution?',
];

export function InsightSearch() {
  const lastQuestion = useLastInsightQuestion();
  const [input, setInput] = useState(lastQuestion ?? '');
  const [activeQuestion, setActiveQuestion] = useState<string | null>(lastQuestion);

  const { data, isFetching, error } = useInsightQuery(activeQuestion);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setInput(trimmed);
    setActiveQuestion(trimmed);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  return (
    <div>
      {/* Search box */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your processes..."
          className="flex-1 px-4 py-2.5 rounded-lg bg-surface-sunken border border-surface-border
                     text-sm text-text-primary placeholder:text-text-tertiary
                     focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent
                     transition-colors"
        />
        <button
          type="submit"
          disabled={isFetching || !input.trim()}
          className="px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium
                     hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors shrink-0"
        >
          {isFetching ? 'Analyzing...' : 'Ask'}
        </button>
      </form>

      {/* Suggestion chips */}
      <div className="flex flex-wrap gap-2 mt-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setInput(s);
              submit(s);
            }}
            disabled={isFetching}
            className="px-3 py-1.5 rounded-full text-[11px] text-text-tertiary
                       bg-surface-sunken border border-surface-border
                       hover:text-text-secondary hover:border-accent/30
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {isFetching && (
        <div className="mt-8 space-y-4 animate-pulse">
          <div className="h-4 w-1/4 bg-surface-border/60 rounded" />
          <div className="h-3.5 w-2/3 bg-surface-border/60 rounded" />
          <div className="flex gap-10 mt-2">
            <div className="space-y-2">
              <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
              <div className="h-6 w-12 bg-surface-border/60 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
              <div className="h-6 w-12 bg-surface-border/60 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-2.5 w-16 bg-surface-border/60 rounded" />
              <div className="h-6 w-12 bg-surface-border/60 rounded" />
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !isFetching && (
        <div className="mt-6 p-4 rounded-lg bg-status-error/10">
          <p className="text-sm text-status-error">{error.message}</p>
        </div>
      )}

      {/* Result */}
      {data && !isFetching && <InsightResultCard result={data} />}
    </div>
  );
}
