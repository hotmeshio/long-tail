import { useState, useRef, useEffect } from 'react';
import { Play } from 'lucide-react';
import { useMcpQuery, useLastMcpQueryPrompt } from '../../api/insight';
import { InsightModal } from './InsightModal';

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
  const lastPrompt = useLastMcpQueryPrompt();

  const [input, setInput] = useState('');
  const [activePrompt, setActivePrompt] = useState<string | null>(lastPrompt);
  const [modalOpen, setModalOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const mcpQuery = useMcpQuery(activePrompt);

  // Open modal automatically when a query starts or has results
  useEffect(() => {
    if (mcpQuery.isFetching || mcpQuery.data || mcpQuery.error) setModalOpen(true);
  }, [mcpQuery.isFetching, mcpQuery.data, mcpQuery.error]);

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
    setActivePrompt(trimmed);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <form onSubmit={handleSubmit} className="relative flex items-center">
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
                         focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/40 focus:border-accent
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
        data={mcpQuery.data}
        isFetching={mcpQuery.isFetching}
        error={mcpQuery.error}
      />
    </>
  );
}
