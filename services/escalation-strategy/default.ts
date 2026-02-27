import type {
  LTEscalationStrategy,
  ResolutionContext,
  ResolutionDirective,
} from '../../types/escalation-strategy';

/**
 * Default escalation strategy.
 *
 * Always returns `{ action: 'rerun' }` — standard behavior where the
 * resolver's payload is injected into the envelope and the original
 * workflow is re-run. This is the strategy used when no MCP triage
 * is configured.
 */
export class DefaultEscalationStrategy implements LTEscalationStrategy {
  async onResolution(_context: ResolutionContext): Promise<ResolutionDirective> {
    return { action: 'rerun' };
  }
}
