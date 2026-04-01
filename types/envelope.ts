/**
 * Authenticated principal resolved at the front door (API route, cron, escalation).
 * Travels with the envelope so workflows and activities never re-query the DB.
 */
export interface LTEnvelopePrincipal {
  id: string;
  type: 'user' | 'bot';
  displayName?: string;
  roles: string[];
  roleType?: string;
}

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
    /** Identity of the user who initiated this workflow. Set by the API route layer. */
    userId?: string;
    /** Resolved principal — set at the front door, never re-queried. */
    principal?: LTEnvelopePrincipal;
    /** Authorization scopes for this invocation. */
    scopes?: string[];
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
