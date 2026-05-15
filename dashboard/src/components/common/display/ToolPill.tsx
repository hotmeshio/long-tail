import { Wrench } from 'lucide-react';

interface ToolPillProps {
  name: string;
  size?: 'sm' | 'md';
}

/**
 * Universal MCP tool pill — displays a tool name with a subtle wrench icon.
 * Used across Capabilities page, MCP Server Tools, Pipeline Tools, etc.
 */
export function ToolPill({ name, size = 'sm' }: ToolPillProps) {
  const sizeClass = size === 'md'
    ? 'px-2 py-0.5 text-[12px] gap-1.5'
    : 'px-1.5 py-px text-[11px] gap-1';
  const iconClass = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2';

  return (
    <span className={`inline-flex items-center ${sizeClass} font-mono text-text-secondary bg-surface-sunken/50 rounded-md`}>
      <Wrench className={`${iconClass} shrink-0 text-text-quaternary`} strokeWidth={1.5} />
      {name}
    </span>
  );
}
