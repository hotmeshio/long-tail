/** Shared type definitions for the mcp-triage workflow. */

import type * as activities from '../../activities/triage';
import type * as interceptorActivities from '../../../services/interceptor/activities';

export interface TriageResponseDeps {
  ltCreateEscalation: typeof interceptorActivities.ltCreateEscalation;
  ltGetTask: typeof interceptorActivities.ltGetTask;
  ltGetWorkflowConfig: typeof interceptorActivities.ltGetWorkflowConfig;
  ltStartWorkflow: typeof interceptorActivities.ltStartWorkflow;
  notifyEngineering: typeof activities.notifyEngineering;
}

export interface TriageContext {
  originId: string;
  originalWorkflowType: string;
  originalTaskQueue: string;
  originalTaskId: string | undefined;
  escalationPayload: Record<string, any>;
  escalationId: string | undefined;
  parentId: string | undefined;
}
