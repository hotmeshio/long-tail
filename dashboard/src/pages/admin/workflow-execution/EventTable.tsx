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

export function EventTable({ events, childTasks }: EventTableProps) {
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const categories = [...new Set(events.map((e) => e.category))].sort();
  const eventTypes = [...new Set(events.map((e) => e.event_type))].sort();

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
      default:
        return 'bg-text-tertiary';
    }
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
                    {evt.attributes.activity_type
                      ? `${evt.event_type} — ${evt.attributes.activity_type}`
                      : evt.event_type}
                  </span>
                  <span className="text-xs font-mono text-text-tertiary shrink-0">
                    {evt.duration_ms !== null ? formatDuration(evt.duration_ms) : '--'}
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
