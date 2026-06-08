import { Radio } from 'lucide-react';

/**
 * Universal event topic display — Radio icon + monotype text.
 * Used everywhere an event subscription topic is rendered.
 * No border, no background — matches CronLabel's simplicity.
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
  const parts = topic.split('.');
  const category = parts[0] === 'system' ? parts[1] : parts[0];
  const iconColor = CATEGORY_COLORS[category] ?? 'text-text-quaternary';
  // Show category.action for system events (e.g., workflow.completed)
  const shortTopic = parts[0] === 'system'
    ? `${parts[1]}.${parts[parts.length - 1]}`
    : parts.slice(-2).join('.');

  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-text-secondary">
      <Radio className={`w-2.5 h-2.5 shrink-0 ${iconColor}`} strokeWidth={1.5} />
      {shortTopic}
    </span>
  );
}
