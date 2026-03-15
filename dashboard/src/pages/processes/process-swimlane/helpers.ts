import type { LTTaskRecord, LTEscalationRecord, LTTaskStatus, LTEscalationStatus } from '../../../api/types';

export interface ProcessLane {
  kind: 'task' | 'escalation';
  id: string;
  label: string;
  taskId: string;
  startMs: number;
  endMs: number;
  startPct: number;
  widthPct: number;
  durationMs: number;
  isOpen: boolean;
  // task fields
  task?: LTTaskRecord;
  // escalation fields
  escalation?: LTEscalationRecord;
  claimPct?: number | null; // percent position of claim within the bar
}

export interface ProcessSwimlaneTimelineProps {
  tasks: LTTaskRecord[];
  escalations: LTEscalationRecord[];
  traceUrl?: string | null;
}

export const PENDING_CLASS = 'bg-stripes animate-pulse opacity-70';

export function taskStatusColor(status: LTTaskStatus): string {
  switch (status) {
    case 'completed': return 'text-status-success';
    case 'in_progress': case 'pending': return 'text-status-warning';
    case 'needs_intervention': return 'text-status-error';
    case 'cancelled': return 'text-text-tertiary';
    default: return 'text-text-tertiary';
  }
}

export function escStatusColor(status: LTEscalationStatus): string {
  switch (status) {
    case 'resolved': return 'text-status-success';
    case 'pending': return 'text-status-warning';
    case 'cancelled': return 'text-text-tertiary';
    default: return 'text-text-tertiary';
  }
}

export function statusLabel(kind: 'task' | 'escalation', status: string, isAck?: boolean): string {
  const noun = kind === 'task' ? 'Task' : isAck ? 'Notification' : 'Escalation';
  return `${noun} is ${status.replace(/_/g, ' ')}`;
}

export function barColorForStatus(status: string, isOpen: boolean): string {
  if (isOpen) return PENDING_CLASS;
  switch (status) {
    case 'completed':
    case 'resolved':
      return 'bg-status-success';
    case 'pending':
    case 'in_progress':
    case 'needs_intervention':
      return 'bg-status-warning';
    case 'cancelled':
      return 'bg-status-error';
    default:
      return 'bg-text-tertiary';
  }
}

export function isMcpWorkflow(workflowType: string): boolean {
  return workflowType.startsWith('mcp') || workflowType.startsWith('Mcp');
}

export function isAckEscalation(esc: LTEscalationRecord): boolean {
  return !esc.workflow_type;
}

export function middleTruncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const keep = Math.floor((maxLen - 1) / 2);
  return `${str.slice(0, keep)}…${str.slice(str.length - keep)}`;
}

export function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Build lanes from raw task + escalation records ──────────────────────────

export function buildLanes(
  tasks: LTTaskRecord[],
  escalations: LTEscalationRecord[],
): { lanes: ProcessLane[]; timeMin: number; timeMax: number } {
  const now = Date.now();

  // Group escalations by task_id
  const escByTask = new Map<string, LTEscalationRecord[]>();
  const unlinked: LTEscalationRecord[] = [];
  for (const e of escalations) {
    if (e.task_id) {
      if (!escByTask.has(e.task_id)) escByTask.set(e.task_id, []);
      escByTask.get(e.task_id)!.push(e);
    } else {
      unlinked.push(e);
    }
  }

  // Sort tasks by created_at
  const sorted = [...tasks].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Collect all timestamps for axis bounds
  const allTimes: number[] = [];
  for (const t of tasks) {
    allTimes.push(new Date(t.created_at).getTime());
    if (t.completed_at) allTimes.push(new Date(t.completed_at).getTime());
  }
  for (const e of escalations) {
    allTimes.push(new Date(e.created_at).getTime());
    if (e.resolved_at) allTimes.push(new Date(e.resolved_at).getTime());
    if (e.claimed_at) allTimes.push(new Date(e.claimed_at).getTime());
  }
  if (allTimes.length === 0) return { lanes: [], timeMin: 0, timeMax: 1 };

  const timeMin = Math.min(...allTimes);
  const hasOpen =
    tasks.some((t) => !t.completed_at) || escalations.some((e) => !e.resolved_at);
  const timeMax = hasOpen ? Math.max(now, Math.max(...allTimes)) : Math.max(...allTimes);
  const span = timeMax - timeMin || 1;

  const toPct = (ms: number) => ((ms - timeMin) / span) * 100;

  const lanes: ProcessLane[] = [];

  for (const task of sorted) {
    const tStart = new Date(task.created_at).getTime();
    const tEnd = task.completed_at ? new Date(task.completed_at).getTime() : now;
    const tOpen = !task.completed_at;

    lanes.push({
      kind: 'task',
      id: task.id,
      label: task.workflow_type,
      taskId: task.id,
      startMs: tStart,
      endMs: tEnd,
      startPct: toPct(tStart),
      widthPct: Math.max(((tEnd - tStart) / span) * 100, 0.5),
      durationMs: tEnd - tStart,
      isOpen: tOpen,
      task,
    });

    const taskEscs = (escByTask.get(task.id) || []).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    for (const esc of taskEscs) {
      const eStart = new Date(esc.created_at).getTime();
      const eEnd = esc.resolved_at ? new Date(esc.resolved_at).getTime() : now;
      const eOpen = !esc.resolved_at;

      let claimPct: number | null = null;
      if (esc.claimed_at) {
        const claimMs = new Date(esc.claimed_at).getTime();
        const escSpan = eEnd - eStart || 1;
        claimPct = ((claimMs - eStart) / escSpan) * 100;
      }

      lanes.push({
        kind: 'escalation',
        id: esc.id,
        label: esc.role,
        taskId: task.id,
        startMs: eStart,
        endMs: eEnd,
        startPct: toPct(eStart),
        widthPct: Math.max(((eEnd - eStart) / span) * 100, 0.5),
        durationMs: eEnd - eStart,
        isOpen: eOpen,
        escalation: esc,
        claimPct,
      });
    }
  }

  // Unlinked escalations at the bottom
  for (const esc of unlinked) {
    const eStart = new Date(esc.created_at).getTime();
    const eEnd = esc.resolved_at ? new Date(esc.resolved_at).getTime() : now;
    let claimPct: number | null = null;
    if (esc.claimed_at) {
      const claimMs = new Date(esc.claimed_at).getTime();
      const escSpan = eEnd - eStart || 1;
      claimPct = ((claimMs - eStart) / escSpan) * 100;
    }
    lanes.push({
      kind: 'escalation',
      id: esc.id,
      label: esc.role,
      taskId: '',
      startMs: eStart,
      endMs: eEnd,
      startPct: toPct(eStart),
      widthPct: Math.max(((eEnd - eStart) / span) * 100, 0.5),
      durationMs: eEnd - eStart,
      isOpen: !esc.resolved_at,
      escalation: esc,
      claimPct,
    });
  }

  return { lanes, timeMin, timeMax };
}
