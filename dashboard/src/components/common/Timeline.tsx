import type { ReactNode } from 'react';

export interface TimelineItem {
  id: string | number;
  label: string;
  timestamp?: string;
  detail?: ReactNode;
  category?: 'system' | 'user';
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-3 bottom-3 w-px bg-surface-border" />

      <div className="space-y-0">
        {items.map((item) => (
          <div key={item.id} className="relative flex gap-4 py-3">
            {/* Dot */}
            <div className="relative z-10 mt-1">
              <div
                className={`w-[15px] h-[15px] rounded-full border-2 ${
                  item.category === 'system'
                    ? 'border-accent-muted bg-surface-raised'
                    : 'border-accent bg-accent'
                }`}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3">
                <p className="text-sm text-text-primary">{item.label}</p>
                {item.timestamp && (
                  <time className="text-[10px] text-text-tertiary font-mono shrink-0">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </time>
                )}
              </div>
              {item.detail && <div className="mt-1">{item.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
