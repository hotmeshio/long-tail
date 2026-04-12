import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface FormatOption {
  label: string;
  value: string;
}

interface DateTooltipProps {
  options: FormatOption[];
  children: ReactNode;
  className?: string;
}

/**
 * Interactive hover tooltip that reveals copyable date/time formats.
 *
 * Renders the popover via a portal so it escapes overflow:hidden ancestors.
 * Clicking an option copies its value and shows brief checkmark feedback.
 */
export function DateTooltip({ options, children, className = '' }: DateTooltipProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, []);

  const handleCopy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(null), 1200);
    } catch { /* clipboard not available */ }
  }, []);

  const handleEnter = useCallback(() => {
    clearTimeout(closeTimeout.current);
    updatePos();
    setOpen(true);
  }, [updatePos]);

  const handleLeave = useCallback(() => {
    closeTimeout.current = setTimeout(() => setOpen(false), 150);
  }, []);

  useEffect(() => () => {
    clearTimeout(timeout.current);
    clearTimeout(closeTimeout.current);
  }, []);

  return (
    <span
      ref={triggerRef}
      className={`inline-flex items-center cursor-default ${className}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {open && pos && createPortal(
        <span
          className="fixed z-[9999] bg-surface-raised border border-surface-border rounded shadow-lg py-1 min-w-[180px]"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => handleCopy(opt.value, opt.label)}
              className="flex items-center justify-between w-full px-2.5 py-1 text-left hover:bg-surface-hover transition-colors"
            >
              <span className="text-[9px] font-medium uppercase tracking-wider text-text-tertiary w-10 shrink-0">
                {opt.label}
              </span>
              <span className="text-[10px] font-mono text-text-secondary truncate ml-2">
                {copied === opt.label ? '\u2713' : opt.value}
              </span>
            </button>
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}
