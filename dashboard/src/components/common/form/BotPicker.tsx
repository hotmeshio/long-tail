import { useState, useRef, useEffect } from 'react';
import { Bot, X, ChevronDown, Check, UserCircle } from 'lucide-react';
import { useBots } from '../../../api/bots';

interface BotPickerProps {
  selected: string;
  onChange: (botExternalId: string) => void;
  placeholder?: string;
}

export function BotPicker({ selected, onChange, placeholder }: BotPickerProps) {
  const { data } = useBots({ limit: 100 });
  const bots = (data?.bots ?? []).filter((b) => b.status === 'active');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedBot = bots.find((b) => b.external_id === selected);
  const placeholderText = placeholder ?? 'Invoking user (default)';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full min-h-[34px] px-2 py-1.5 bg-surface-sunken border border-surface-border rounded-md text-left cursor-pointer hover:border-accent/40 transition-colors focus:ring-1 focus:ring-accent focus:outline-none"
      >
        {selected && selectedBot ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/[0.08] text-text-secondary text-[11px]">
            <Bot className="w-2.5 h-2.5 shrink-0 text-accent/75" />
            {selectedBot.display_name || selectedBot.external_id}
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="ml-0.5 hover:text-status-error transition-colors"
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
            <UserCircle className="w-3 h-3 shrink-0" />
            {placeholderText}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-surface-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {/* Default: invoking user */}
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs transition-colors ${
              !selected ? 'bg-accent/[0.06] text-accent' : 'text-text-primary hover:bg-surface-sunken'
            }`}
          >
            <UserCircle className="w-3 h-3 shrink-0 text-text-tertiary" />
            <span className="flex-1">Invoking user</span>
            {!selected && <Check className="w-3 h-3 shrink-0" />}
          </button>

          {bots.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">No bot accounts</p>
          ) : (
            bots.map((bot) => {
              const isSelected = selected === bot.external_id;
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => { onChange(bot.external_id); setOpen(false); }}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-accent/[0.06] text-accent'
                      : 'text-text-primary hover:bg-surface-sunken'
                  }`}
                >
                  <Bot className="w-3 h-3 shrink-0 text-accent/60" />
                  <div className="flex-1 min-w-0">
                    <span>{bot.display_name || bot.external_id}</span>
                    {bot.display_name && bot.display_name !== bot.external_id && (
                      <span className="ml-1 text-text-tertiary font-mono">{bot.external_id}</span>
                    )}
                  </div>
                  {isSelected && <Check className="w-3 h-3 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
