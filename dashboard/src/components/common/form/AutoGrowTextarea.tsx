import { useRef, useLayoutEffect } from 'react';

/**
 * Quiet multiline field: a whisper of background makes the writable region
 * visible without a border box, and the field grows with its content — no
 * inner scrollbar, no resize handle. `rows` sets the resting height.
 */
export function AutoGrowTextarea({
  value,
  onChange,
  rows = 2,
  className = '',
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  className?: string;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'rows' | 'className'>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className={`textarea-quiet ${className}`}
      {...rest}
    />
  );
}
