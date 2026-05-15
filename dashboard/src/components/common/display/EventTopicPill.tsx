import { Radio } from 'lucide-react';

/**
 * Event topic pill — displays a dot-delimited event type with a color-coded
 * Radio icon. Color is derived from the event category (first segment).
 *
 * Mirrors the WorkflowPill pattern but for the event topic space.
 */

const CATEGORY_COLORS: Record<string, string> = {
  task:       'text-blue-400',
  workflow:   'text-accent',
  escalation: 'text-amber-400',
  activity:   'text-cyan-400',
  knowledge:  'text-violet-400',
  agent:      'text-emerald-400',
  app:        'text-rose-400',
  milestone:  'text-violet-400',
};

interface EventTopicPillProps {
  topic: string;
}

export function EventTopicPill({ topic }: EventTopicPillProps) {
  const category = topic.split('.')[0];
  const iconColor = CATEGORY_COLORS[category] ?? 'text-text-tertiary';
  // Show the last two segments for compactness: "workflow.completed", "activity.started"
  const shortTopic = topic.split('.').slice(-2).join('.');

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-px text-[11px] font-mono text-text-secondary border border-surface-border rounded-lg">
      <Radio className={`w-2 h-2 shrink-0 ${iconColor}`} strokeWidth={2} />
      {shortTopic}
    </span>
  );
}
