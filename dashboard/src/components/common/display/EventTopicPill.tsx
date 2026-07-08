import { Radio } from 'lucide-react';

/**
 * Universal event topic display — Radio icon + monotype text.
 * Used everywhere an event subscription topic is rendered.
 * No border, no background — matches CronLabel's simplicity.
 */

const CATEGORY_COLORS: Record<string, string> = {
  task:       'text-status-active',
  workflow:   'text-accent',
  escalation: 'text-status-warning',
  activity:   'text-status-active',
  knowledge:  'text-accent',
  agent:      'text-status-success',
  app:        'text-status-error',
  milestone:  'text-accent',
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
