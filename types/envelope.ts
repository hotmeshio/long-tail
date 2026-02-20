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
  };
  resolver?: Record<string, any>;
}
