/**
 * Full workflow configuration as stored in the database.
 * Includes all sub-entities (roles, lifecycle hooks, consumers).
 */
export interface LTWorkflowConfig {
  workflow_type: string;
  is_lt: boolean;
  is_container: boolean;
  invocable: boolean;
  task_queue: string | null;
  default_role: string;
  default_modality: string;
  description: string | null;
  roles: string[];
  invocation_roles: string[];
  lifecycle: {
    onBefore: LTLifecycleHook[];
    onAfter: LTLifecycleHook[];
  };
  consumes: string[];
}

export interface LTLifecycleHook {
  target_workflow_type: string;
  target_task_queue: string | null;
  ordinal: number;
}

/**
 * Resolved config used by interceptor/executeLT at runtime.
 * Flat structure with camelCase keys — no DB row noise.
 */
export interface LTResolvedConfig {
  isLT: boolean;
  isContainer: boolean;
  invocable: boolean;
  taskQueue: string | null;
  role: string;
  modality: string;
  roles: string[];
  invocationRoles: string[];
  onBefore: LTLifecycleHook[];
  onAfter: LTLifecycleHook[];
  consumes: string[];
}

/**
 * Provider data returned by ltGetProviderData.
 * Keyed by workflow type name from the `consumes` array.
 */
export interface LTProviderData {
  [providerName: string]: {
    data: Record<string, any>;
    completedAt: string;
    workflowType: string;
  };
}
