import type { CapabilityAccess, CapabilitySet } from '../../types';

/** A superadmin: every capability. */
export const ALL_CAPABILITIES: CapabilitySet = {
  caller: true, admin: true, builder: true, roleManager: true, superadmin: true,
};

/** An authenticated caller with no administrative capability. */
export const MEMBER_CAPABILITIES: CapabilitySet = {
  caller: true, admin: false, builder: false, roleManager: false, superadmin: false,
};

/** Capability checks answered from a fixed set. */
export function accessFor(set: CapabilitySet): CapabilityAccess {
  return async (gate) => set[gate];
}
