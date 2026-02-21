/**
 * The standard envelope passed to every Long Tail workflow.
 *
 * - `data`: Business inputs — domain data the workflow processes.
 * - `metadata`: Control flow and non-business data.
 * - `lt`: Automatically managed by the interceptor. Do not set manually.
 * - `resolver`: Present on re-entry from human escalation.
 */
export interface LTEnvelope {
  data: Record<string, any>;
  metadata: {
    [key: string]: any;
  };
  lt?: {
    modality?: string;
    escalationId?: string;
    escalationStatus?: string;
    originId?: string;
    parentId?: string;
    signalId?: string;
    taskId?: string;
    providers?: import('./config').LTProviderData;
    /** Orchestrator workflow ID — set by executeLT for signal routing */
    parentWorkflowId?: string;
    /** Orchestrator task queue — set by executeLT for signal routing */
    parentTaskQueue?: string;
    /** Orchestrator workflow function name — set by executeLT for signal routing */
    parentWorkflowType?: string;
  };
  resolver?: Record<string, any>;
}
