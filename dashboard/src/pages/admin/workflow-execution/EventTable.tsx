import { useState } from 'react';
import { FilterBar, FilterSelect } from '../../../components/common/FilterBar';
import { Collapsible } from '../../../components/common/Collapsible';
import type { WorkflowExecutionEvent, LTTaskRecord } from '../../../api/types';
import { EventDetailPanel } from './EventDetailPanel';
import { formatDuration } from './utils';

interface EventTableProps {
  events: WorkflowExecutionEvent[];
  childTasks?: LTTaskRecord[];
}

/** Event types that represent the "start" phase of a paired operation */
const STARTED_TYPES = new Set([
  'activity_task_scheduled',
  'timer_started',
  'child_workflow_execution_started',
  'signal_wait_started',
]);

/** Completion event types that close a paired operation */
const COMPLETED_TYPES = new Set([
  'activity_task_completed',
  'activity_task_failed',
  'timer_fired',
  'child_workflow_execution_completed',
  'child_workflow_execution_failed',
  'workflow_execution_signaled',
]);

/**
 * Build a set of timeline_keys that have a matching completion event.
 * A "scheduled" event is only truly pending if no completion exists.
 */
function buildCompletedKeys(events: WorkflowExecutionEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const e of events) {
    if (COMPLETED_TYPES.has(e.event_type) && e.attributes.timeline_key) {
      keys.add(e.attributes.timeline_key);
    }
  }
  return keys;
}

export function EventTable({ events, childTasks }: EventTableProps) {
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const categories = [...new Set(events.map((e) => e.category))].sort();
  const eventTypes = [...new Set(events.map((e) => e.event_type))].sort();
  const completedKeys = buildCompletedKeys(events);

  /** True only when a "started/scheduled" event has no matching completion */
  const isPending = (evt: WorkflowExecutionEvent): boolean => {
    if (evt.duration_ms !== null) return false;
    if (!STARTED_TYPES.has(evt.event_type)) return false;
    const tlk = evt.attributes.timeline_key;
    if (tlk && completedKeys.has(tlk)) return false;
    return true;
  };

  let filtered = events;
  if (categoryFilter) filtered = filtered.filter((e) => e.category === categoryFilter);
  if (typeFilter) filtered = filtered.filter((e) => e.event_type === typeFilter);

  filtered = [...filtered].sort((a, b) =>
    sortOrder === 'asc' ? a.event_id - b.event_id : b.event_id - a.event_id,
  );

  const categoryDot = (category: string) => {
    switch (category) {
      case 'activity':
        return 'bg-accent';
      case 'signal':
        return 'bg-status-active';
      case 'timer':
        return 'bg-status-warning';
      case 'child_workflow':
        return 'bg-purple-500';
      default:
        return 'bg-text-tertiary';
    }
  };

  /** Build a descriptive label for an event row */
  const eventLabel = (evt: WorkflowExecutionEvent): string => {
    const base = evt.event_type;
    if (evt.attributes.activity_type) {
      return `${base} — ${evt.attributes.activity_type}`;
    }
    if (evt.attributes.signal_name) {
      return `${base} — ${evt.attributes.signal_name}`;
    }
    if (evt.attributes.child_workflow_id) {
      const id = evt.attributes.child_workflow_id;
      const truncated = id.length > 24 ? `${id.slice(0, 24)}...` : id;
      return `${base} — ${truncated}`;
    }
    return base;
  };

  /** Find a matching child task for an event's activity_type */
  const findChildTask = (evt: WorkflowExecutionEvent): LTTaskRecord | undefined => {
    if (!childTasks?.length) return undefined;
    const activityType = evt.attributes.activity_type;
    if (!activityType) return undefined;
    return childTasks.find((t) => t.workflow_type === activityType);
  };

  const toggleEvent = (id: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allExpanded = filtered.length > 0 && filtered.every((e) => expandedEvents.has(e.event_id));

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedEvents(new Set());
    } else {
      setExpandedEvents(new Set(filtered.map((e) => e.event_id)));
    }
  };

  return (
    <div>
      <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Events ({filtered.length})
          </p>
          {filtered.length > 0 && (
            <button onClick={toggleAll} className="text-[10px] text-accent hover:underline">
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
        <FilterBar>
          <FilterSelect
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categories.map((c) => ({ value: c, label: c }))}
          />
          <FilterSelect
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={eventTypes.map((t) => ({ value: t, label: t }))}
          />
          <button
            onClick={() => setSortOrder((s) => (s === 'asc' ? 'desc' : 'asc'))}
            className="btn-ghost text-xs"
          >
            {sortOrder === 'asc' ? 'Oldest first' : 'Newest first'}
          </button>
        </FilterBar>
      </div>

      <div>
        {filtered.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-text-tertiary">No events match the current filters</p>
          </div>
        ) : (
          filtered.map((evt) => {
            const isExpanded = expandedEvents.has(evt.event_id);
            const pending = isPending(evt);

            return (
              <div
                key={evt.event_id}
                className="border-b border-surface-border last:border-b-0"
              >
                {/* Row header */}
                <div
                  className="px-6 py-3 flex items-center gap-4 cursor-pointer hover:bg-surface-sunken transition-colors duration-100"
                  onClick={() => toggleEvent(evt.event_id)}
                >
                  {/* Expand chevron */}
                  <span
                    className={`text-[10px] text-text-tertiary transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                  >
                    &#9654;
                  </span>

                  <span className="text-xs font-mono text-text-tertiary w-8 shrink-0">
                    {evt.event_id}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${categoryDot(evt.category)}`}
                  />
                  <span className="text-sm text-text-primary flex-1 truncate">
                    {eventLabel(evt)}
                  </span>
                  <span className="text-xs font-mono text-text-tertiary shrink-0">
                    {pending ? (
                      <span className="inline-flex items-center gap-1 text-status-warning">
                        <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
                        Pending
                      </span>
                    ) : evt.duration_ms !== null ? (
                      formatDuration(evt.duration_ms)
                    ) : (
                      '--'
                    )}
                  </span>
                  <time className="text-[10px] font-mono text-text-tertiary shrink-0">
                    {new Date(evt.event_time).toLocaleTimeString()}
                  </time>
                </div>

                {/* Inline detail panel — directly below the clicked row */}
                <Collapsible open={isExpanded && !!evt.attributes}>
                  <div className="px-6 pb-4 pl-16">
                    <EventDetailPanel
                      event={evt}
                      childTask={findChildTask(evt)}
                      pending={pending}
                      onClose={() => toggleEvent(evt.event_id)}
                    />
                  </div>
                </Collapsible>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
