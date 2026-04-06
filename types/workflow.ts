import type { LTMilestone } from './task';

/**
 * Return this from a workflow when AI processing completes successfully.
 */
export interface LTReturn {
  type: 'return';
  data: Record<string, any>;
  milestones?: LTMilestone[];
}

/**
 * Return this from a workflow to trigger human escalation.
 * The LT interceptor will create an escalation record and
 * pause the workflow until a human resolves it.
 */
export interface LTEscalation {
  type: 'escalation';
  data: Record<string, any>;
  message: string;
  role?: string;
  priority?: 1 | 2 | 3 | 4;
}

/**
 * Return this from a proxied activity to report incremental
 * milestone progress. The interceptor appends these milestones
 * to the task record and publishes them to NATS.
 */
export interface LTActivity<T = any> {
  type: 'activity';
  data: T;
  milestones?: LTMilestone[];
}

/**
 * Union of all workflow return types.
 */
export type LTResult = LTReturn | LTEscalation | LTActivity;
