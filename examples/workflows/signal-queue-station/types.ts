export interface StepInput {
  stationName: string;
  role: string;
  instructions: string;
  workflowId: string;
  taskQueue: string;
  signalId: string;
}

export interface StepResult {
  stationName: string;
  resolution: Record<string, any>;
  completedAt: string;
}
