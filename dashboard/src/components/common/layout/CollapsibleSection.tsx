import type { ReactNode } from 'react';
import { Collapsible } from './Collapsible';

/**
 * Shared collapsible section with chevron toggle and horizontal rule.
 * Used by WorkflowExecutionPage, McpRunDetailPage, and YamlWorkflowDetailPage.
 */
export function CollapsibleSection({
  title,
  sectionKey,
  isCollapsed,
  onToggle,
  contentClassName,
  children,
}: {
  title: string;
  sectionKey: string;
  isCollapsed: boolean;
  onToggle: (key: string) => void;
  /** Optional class override for the content wrapper (default: "mt-4 ml-7") */
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        onClick={() => onToggle(sectionKey)}
        className="flex items-center gap-3 w-full group/section"
      >
        <svg
          className={`w-4 h-4 shrink-0 text-text-tertiary/40 group-hover/section:text-text-tertiary transition-all duration-200 ${!isCollapsed ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`text-xs font-semibold uppercase tracking-widest transition-colors duration-200 ${isCollapsed ? 'text-text-tertiary' : 'text-text-secondary'}`}>
          {title}
        </span>
        <span className="flex-1 border-b border-surface-border" />
      </button>
      <Collapsible open={!isCollapsed}>
        <div className={contentClassName ?? 'mt-4 ml-7'}>{children}</div>
      </Collapsible>
    </div>
  );
}
