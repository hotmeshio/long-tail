/**
 * The capability a caller needs to see and call an MCP tool at `/mcp`.
 *
 * - `caller`: any authenticated caller
 * - `admin`: admin or superadmin
 * - `builder`: superadmin or the `engineer` role
 * - `roleManager`: admin, superadmin or the `engineer` role
 * - `superadmin`: superadmin only
 */
export type CapabilityGate = 'caller' | 'admin' | 'builder' | 'roleManager' | 'superadmin';

/** The capabilities a caller holds, resolved once per `/mcp` request. */
export type CapabilitySet = Record<CapabilityGate, boolean>;

/** Whether the caller holds a capability. `caller` is free; the rest may cost a lookup. */
export type CapabilityAccess = (gate: CapabilityGate) => Promise<boolean>;
