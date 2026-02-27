import type { LTEscalationRecord } from './escalation';

/**
 * Context provided to the escalation strategy when a resolver submits.
 */
export interface ResolutionContext {
  /** The escalation being resolved */
  escalation: LTEscalationRecord;
  /** The resolver's payload */
  resolverPayload: Record<string, any>;
  /** The reconstructed envelope (with lt fields preserved) */
  envelope: Record<string, any>;
}

/**
 * Directive returned by the strategy, controlling what happens after resolution.
 *
 * - `rerun` — standard re-run: start the original workflow with resolver data (default behavior)
 * - `triage` — route to the MCP triage orchestrator for dynamic remediation
 */
export type ResolutionDirective =
  | { action: 'rerun' }
  | { action: 'triage'; triageEnvelope: Record<string, any> };

/**
 * Pluggable escalation strategy.
 *
 * Determines what happens when a resolver submits a resolution. The default
 * strategy always returns `{ action: 'rerun' }` — standard re-run behavior.
 * The MCP strategy checks for `resolverPayload._lt.needsTriage` and routes
 * to the triage orchestrator when set.
 *
 * Follows the same adapter pattern as auth, events, telemetry, and logging.
 */
export interface LTEscalationStrategy {
  onResolution(context: ResolutionContext): Promise<ResolutionDirective>;
}
