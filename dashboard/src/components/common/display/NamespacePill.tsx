import { Layers } from 'lucide-react';

interface NamespacePillProps {
  namespace: string;
  size?: 'sm' | 'md';
}

/**
 * The namespace a workflow belongs to — `graph` for graph flows in the graph
 * app, `durable` for procedural workflows. A subtle attribute pill, never a card.
 */
export function NamespacePill({ namespace, size = 'sm' }: NamespacePillProps) {
  const sizeClass = size === 'md'
    ? 'px-2 py-0.5 text-xs gap-1.5'
    : 'px-1.5 py-px text-2xs gap-1';
  const iconClass = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2';

  return (
    <span className={`inline-flex items-center ${sizeClass} font-mono text-text-tertiary bg-surface-sunken/50 rounded-md`}>
      <Layers className={`${iconClass} shrink-0 text-text-quaternary`} strokeWidth={1.5} />
      {namespace}
    </span>
  );
}
