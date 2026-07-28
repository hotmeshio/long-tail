/**
 * Runtime feature flags surfaced to the dashboard via /api/settings.
 *
 * These gate UI affordances (nav entries, routes) that some deployments want to
 * hide. Defaults are permissive (everything on); a deployment opts OUT through
 * the `features` block of the `start()` config. The dashboard reads the resolved
 * flags from `settings.features` and hides the corresponding nav item + route.
 */
export interface FeatureFlags {
  /**
   * Show the DB Maintenance admin page (nav entry + route).
   * Default: true. Set `features.dbMaintenance: false` in start config to hide it.
   */
  dbMaintenance: boolean;
  /**
   * The Pace Board is readable by every authenticated user: station metrics
   * (aggregate queue-shape counts and trends — never item content) span all
   * roles for any login, and the board leads everyone's home page. Default:
   * true. Set `features.publicPaceBoard: false` to scope metrics back to role
   * membership — the right call for deployments that provision external
   * one-time accounts (e.g. a customer resolving a single form).
   */
  publicPaceBoard: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  dbMaintenance: true,
  publicPaceBoard: true,
};

let flags: FeatureFlags = { ...DEFAULT_FLAGS };

/** Merge a partial set of flags from the start config. Unspecified flags keep their default. */
export function configureFeatureFlags(patch?: Partial<FeatureFlags>): void {
  flags = { ...DEFAULT_FLAGS, ...(patch ?? {}) };
}

/** The resolved feature flags reported to the dashboard. */
export function getFeatureFlags(): FeatureFlags {
  return { ...flags };
}
