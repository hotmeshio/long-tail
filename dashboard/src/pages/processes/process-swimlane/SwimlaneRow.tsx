import { Collapsible } from '../../../components/common/layout/Collapsible';
import { formatDuration } from '../../../lib/format';
import {
  taskStatusColor,
  escStatusColor,
  statusLabel,
  barColorForStatus,
  isMcpWorkflow,
  isAckEscalation,
  middleTruncate,
} from './helpers';
import type { ProcessLane } from './helpers';
import type { BarAnim } from './useTimelineAnimation';
import type { Tick } from './TimeAxis';
import { ClipboardIcon, SparkleIcon, BellIcon, UserIcon } from './SwimlaneIcons';
import { TaskDetailPanel } from './TaskDetailPanel';
import { EscalationDetailPanel } from './EscalationDetailPanel';

interface SwimlaneRowProps {
  lane: ProcessLane;
  ticks: Tick[];
  isExpanded: boolean;
  onToggle: () => void;
  anim: BarAnim;
  animDone: boolean;
  traceUrl?: string | null;
}

export function SwimlaneRow({
  lane,
  ticks,
  isExpanded,
  onToggle,
  anim,
  animDone,
  traceUrl,
}: SwimlaneRowProps) {
  const isTask = lane.kind === 'task';
  const status = isTask ? lane.task!.status : lane.escalation!.status;
  const barBase = barColorForStatus(status, lane.isOpen);
  const visible = anim.opacity > 0;

  return (
    <div>
      {/* Lane row */}
      <div
        className="flex items-center border-b border-surface-border cursor-pointer hover:bg-surface-sunken/40 transition-colors"
        onClick={onToggle}
      >
        {/* Label column */}
        <div
          className={`w-52 shrink-0 py-3 pr-4 flex items-center gap-2 ${
            isTask ? '' : 'pl-6'
          }`}
          style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.15s ease-out' }}
        >
          {isTask ? (
            isMcpWorkflow(lane.task!.workflow_type) ? (
              <SparkleIcon
                className={`w-4 h-4 shrink-0 ${taskStatusColor(lane.task!.status)}`}
              />
            ) : (
              <ClipboardIcon
                className={`w-4 h-4 shrink-0 ${taskStatusColor(lane.task!.status)}`}
              />
            )
          ) : isAckEscalation(lane.escalation!) ? (
            <BellIcon
              className={`w-4 h-4 shrink-0 ${escStatusColor(lane.escalation!.status)}`}
            />
          ) : (
            <UserIcon
              className={`w-4 h-4 shrink-0 ${escStatusColor(lane.escalation!.status)}`}
            />
          )}
          <p
            className="text-xs font-mono text-text-secondary whitespace-nowrap overflow-hidden"
            title={statusLabel(lane.kind, isTask ? lane.task!.status : lane.escalation!.status, !isTask && isAckEscalation(lane.escalation!))}
          >
            {isTask
              ? middleTruncate(lane.label, 24)
              : middleTruncate(lane.escalation?.role ?? lane.label, 20)}
          </p>
        </div>

        {/* Bar area */}
        <div className="flex-1 relative h-10">
          {/* Tick gridlines */}
          {ticks.map((tick) => (
            <div
              key={tick.pct}
              className="absolute top-0 bottom-0 w-px bg-surface-border opacity-30"
              style={{ left: `${tick.pct}%` }}
            />
          ))}

          {/* Duration bar (animated reveal + grow) */}
          <div
            className={`absolute top-2 h-6 rounded-sm ${
              isExpanded
                ? `${barBase} ring-2 ring-accent ring-offset-1`
                : `${barBase} hover:opacity-80`
            }`}
            style={{
              left: `${lane.startPct}%`,
              width: visible ? `${Math.max(anim.width, 0.3)}%` : '0%',
              minWidth: visible ? '4px' : '0px',
              opacity: anim.opacity,
            }}
            title={`${lane.label} — ${formatDuration(lane.durationMs)} — ${new Date(lane.startMs).toLocaleTimeString()}`}
          >
            {/* Duration text inside bar (show only when fully revealed) */}
            {anim.width > 8 && animDone && (
              <span className="absolute inset-0 flex items-center px-1.5 text-[9px] font-mono text-white truncate">
                {formatDuration(lane.durationMs)}
              </span>
            )}

            {/* Claim marker (vertical dashed line) — show after animation */}
            {lane.claimPct != null && animDone && (
              <div
                className="absolute top-0 bottom-0 w-px border-l border-dashed border-white/70"
                style={{ left: `${lane.claimPct}%` }}
                title={
                  lane.escalation?.assigned_to
                    ? `Claimed by ${lane.escalation.assigned_to}`
                    : 'Claimed'
                }
              >
                {/* Claim dot */}
                <div className="absolute -top-1 -left-[3px] w-[7px] h-[7px] rounded-full bg-white border border-amber-600" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expandable detail panel */}
      <Collapsible open={isExpanded}>
        <div className="py-4 px-6 pl-52 border-b border-surface-border bg-surface-sunken/20">
          {isTask && lane.task ? (
            <TaskDetailPanel task={lane.task} traceUrl={traceUrl} />
          ) : lane.escalation ? (
            <EscalationDetailPanel escalation={lane.escalation} />
          ) : null}
        </div>
      </Collapsible>
    </div>
  );
}
