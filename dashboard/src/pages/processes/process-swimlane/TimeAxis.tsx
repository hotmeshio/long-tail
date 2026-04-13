export interface Tick {
  pct: number;
  label: string;
}

interface TimeAxisProps {
  ticks: Tick[];
}

export function TimeAxis({ ticks }: TimeAxisProps) {
  return (
    <div className="flex">
      <div className="w-52 shrink-0" />
      <div className="flex-1 relative h-6 border-b border-surface-border">
        {ticks.map((tick) => (
          <span
            key={tick.pct}
            className="absolute text-[9px] font-mono text-text-tertiary -translate-x-1/2 bottom-1 whitespace-nowrap"
            style={{ left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
