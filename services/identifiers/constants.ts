import type { BoundVia } from '../../types/identifiers';

export const BOUND_VIA = { API: 'api', SCAN: 'scan', WORKFLOW: 'workflow' } as const satisfies Record<string, BoundVia>;

/** Longest scanned value a binding holds, and longest target. */
export const RAW_MAX = 256;
export const TARGET_MAX = 64;

export const LIST_LIMIT_DEFAULT = 100;
export const LIST_LIMIT_MAX = 500;
