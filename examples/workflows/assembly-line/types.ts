/**
 * Assembly Line types.
 *
 * Defines the station config passed in the envelope and the
 * result shape each station returns when a human resolves it.
 */

export interface AssemblyLineStation {
  stationName: string;
  role: string;
  instructions: string;
}

export interface StationEnvelopeData {
  stationName: string;
  role: string;
  instructions: string;
  parentSignalId: string;
  parentTaskQueue: string;
  parentWorkflowType: string;
  parentWorkflowId: string;
}

export interface StationResult {
  stationName: string;
  resolution: Record<string, any>;
  completedAt: string;
}
