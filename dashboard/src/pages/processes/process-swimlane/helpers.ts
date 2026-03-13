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
