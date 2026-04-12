import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useSubmitMcpQueryRouted } from '../../api/mcp-query';

export function QuickQuery() {
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { mutate, isPending } = useSubmitMcpQueryRouted();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isPending) return;
    mutate({ prompt: trimmed }, {
      onSuccess: (data) => {
        setPrompt('');
        navigate(`/processes/detail/${data.workflow_id}`);
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center">
      <input
        ref={inputRef}
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask anything..."
        className="w-64 focus-within:w-80 transition-all duration-200 h-8 pl-3 pr-8 text-xs bg-surface-sunken border border-surface-border rounded-md text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/50"
        disabled={isPending}
      />
      <button
        type="submit"
        disabled={!prompt.trim() || isPending}
        className="absolute right-2 text-text-tertiary hover:text-accent disabled:opacity-30 disabled:hover:text-text-tertiary transition-colors"
        aria-label="Submit query"
      >
        <Search className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
    </form>
  );
}
