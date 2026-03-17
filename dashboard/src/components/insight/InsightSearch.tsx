import { useState, useRef, useEffect } from 'react';
import { Play } from 'lucide-react';
import {
  useInsightQuery,
  useMcpQuery,
  useLastInsightQuestion,
  useLastMcpQueryPrompt,
} from '../../api/insight';
import type { QueryMode } from '../../api/insight';
import { InsightModal } from './InsightModal';

// Ask suggestions retained for future re-enablement of Ask/Do mode toggle
// const ASK_SUGGESTIONS = [
//   'Which workflow types have the most escalations?',
//   'Show me all escalated processes',
//   'What is the current workload by role?',
//   'How many tasks completed in the last 24 hours?',
//   'Summarize today\'s activity',
//   'Trace the most recent failed task — what happened in the workflow execution?',
// ];

const SUGGESTIONS = [
  'Run a browser script: navigate to http://localhost:3000/login, fill #username with "superadmin", fill #password with "l0ngt@1l", click button[type="submit"], wait_for_url not matching /login, wait 5 seconds for SPA data to load, then screenshot the full page and save to /screenshots/docs/home.png',
  'Run a browser script: navigate to http://localhost:3000/login, fill #username with "superadmin", fill #password with "l0ngt@1l", click button[type="submit"], wait_for_url not matching /login, navigate to http://localhost:3000/escalations, wait 5 seconds for data to load, and screenshot to /screenshots/docs/escalations.png',
  'Run a browser script: navigate to http://localhost:3000/login, fill #username with "superadmin", fill #password with "l0ngt@1l", click button[type="submit"], wait_for_url not matching /login, navigate to /workflows, wait 5 seconds, screenshot to /screenshots/docs/workflows.png, then navigate to /mcp/servers, wait 5 seconds, and screenshot to /screenshots/docs/mcp-servers.png',
  'Run a browser script: navigate to https://news.ycombinator.com, wait 3 seconds, screenshot the front page as /screenshots/hn.png, click the first story link, wait_for_url change, wait 3 seconds, and screenshot that page as /screenshots/hn-top-story.png',
  'Take a screenshot of https://example.com and save as /screenshots/example.png',
  'Fetch https://api.github.com/zen and save the response to /notes/zen.txt',
  'Check system health and write a summary report to /reports/health.txt',
];

export function InsightSearch() {
  const lastQuestion = useLastInsightQuestion();
  const lastPrompt = useLastMcpQueryPrompt();

  // Mode toggle hidden for now — default to 'do'. Re-enable by uncommenting the toggle below.
  const [mode, setMode] = useState<QueryMode>('do');
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

  // Keep setMode wired up for future re-enablement
  void setMode;

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <form onSubmit={handleSubmit} className="relative flex items-center">
          {/* Mode toggle — hidden for now; re-enable by uncommenting
          <div className="flex rounded-md border border-surface-border bg-surface-sunken overflow-hidden shrink-0 mr-1">
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
          */}

          {/* Input */}
          <div className="relative flex items-center">
            <Play className="absolute left-2.5 w-3.5 h-3.5 text-accent/60 pointer-events-none" />
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setSuggestionsOpen(true); }}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder="Do something with tools..."
              className="w-[22rem] pl-8 pr-3 py-1.5 rounded-md bg-surface-sunken border border-surface-border
                         text-[11px] text-text-primary placeholder:text-text-tertiary
                         focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent
                         transition-colors"
            />
          </div>
        </form>

        {/* Suggestion dropdown */}
        {suggestionsOpen && !input.trim() && (
          <div className="absolute top-full right-0 mt-1 w-[28rem] max-h-80 overflow-y-auto bg-surface-raised border border-surface-border rounded-md shadow-lg z-40 py-1">
            <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">
              Try something
            </div>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="w-full text-left px-3 py-2 text-[11px] text-text-secondary
                           hover:bg-surface-hover transition-colors leading-relaxed"
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
