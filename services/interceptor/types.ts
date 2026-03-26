/** Shared type definitions for the interceptor module. */

import type { LTEnvelope, LTResolvedConfig } from '../../types';
import type { ProxiedActivities } from './state';

/**
 * Mutable state carried through a single interceptor execute() call.
 * Populated incrementally as context is resolved, then passed to
 * the escalation and completion submodules.
 */
export interface InterceptorState {
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  wfConfig: LTResolvedConfig | null;
  defaultRole: string;
  defaultModality: string;
  taskId: string | undefined;
  routing: Record<string, any> | null;
  envelope: LTEnvelope | undefined;
  isReRun: boolean;
  activities: ProxiedActivities;
  traceId?: string;
  spanId?: string;
}

export interface OrchestratorContext {
  workflowId: string;
  taskQueue: string;
  workflowType: string;
}

/** Identity fields extracted from the HotMesh workflow context. */
export interface WorkflowIdentity {
  workflowId: string;
  workflowName: string;
  workflowTopic: string;
  workflowTrace: string | undefined;
  workflowSpan: string | undefined;
}

/** Result of task + routing resolution. */
export interface TaskContext {
  taskId: string | undefined;
  routing: Record<string, any> | null;
  originId: string;
}
