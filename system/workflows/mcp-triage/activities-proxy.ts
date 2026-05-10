import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import * as activities from '../../activities/triage';
import * as interceptorActivities from '../../../services/interceptor/activities';
import type { TriageResponseDeps } from './types';

type ActivitiesType = typeof activities;

const {
  getUpstreamTasks,
  getEscalationHistory,
  getToolTags,
  loadTriageTools,
  callTriageTool,
  callTriageLLM,
  notifyEngineering,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const {
  ltCreateEscalation,
  ltCreateTask,
  ltGetTask,
  ltGetWorkflowConfig,
  ltStartWorkflow,
  ltEnrichEscalationRouting,
} = Durable.workflow.proxyActivities<typeof interceptorActivities>({
  activities: interceptorActivities,
  taskQueue: 'lt-interceptor',
  retry: { maximumAttempts: 3 },
});

export const MAX_TOOL_ROUNDS = TOOL_ROUNDS_TRIAGE;

/** Proxied activity refs passed to response handlers */
export const responseDeps: TriageResponseDeps = {
  ltCreateEscalation,
  ltCreateTask,
  ltGetTask,
  ltGetWorkflowConfig,
  ltStartWorkflow,
  notifyEngineering,
};

export {
  getUpstreamTasks,
  getEscalationHistory,
  getToolTags,
  loadTriageTools,
  callTriageTool,
  callTriageLLM,
  ltEnrichEscalationRouting,
};
