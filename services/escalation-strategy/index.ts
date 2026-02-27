import type { LTEscalationStrategy } from '../../types/escalation-strategy';

/**
 * Singleton registry for the escalation strategy.
 *
 * Follows the same pattern as mcpRegistry (single adapter):
 * - register(strategy) — set the active strategy
 * - clear()            — reset (for tests)
 *
 * The strategy is consulted during escalation resolution to determine
 * whether to perform a standard re-run or route to the MCP triage
 * orchestrator for dynamic remediation.
 */
class LTEscalationStrategyRegistry {
  private strategy: LTEscalationStrategy | null = null;

  register(strategy: LTEscalationStrategy): void {
    this.strategy = strategy;
  }

  clear(): void {
    this.strategy = null;
  }

  get hasStrategy(): boolean {
    return this.strategy !== null;
  }

  get current(): LTEscalationStrategy | null {
    return this.strategy;
  }
}

export const escalationStrategyRegistry = new LTEscalationStrategyRegistry();
