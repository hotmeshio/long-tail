/**
 * Every route in the route files that carry an admin, builder or
 * role-manager gate, with the gate that guards it today (`none` means
 * `requireAuth` only). Paths are relative to `/api`.
 */

export type Gate = 'none' | 'admin' | 'builder' | 'roleManager';

export interface GatedRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  gate: Gate;
  body?: unknown;
}

/** The 401/403 bodies the gates return, and nothing a handler returns. */
export const GATE_DENIALS = [
  'Forbidden',
  'Forbidden: admin access required',
  'Forbidden: builder access required',
  'Forbidden: role-management access required',
];

const ID = '00000000-0000-4000-8000-0000000000c1';

export const GATED_ROUTES: GatedRoute[] = [
  // routes/users.ts
  { method: 'GET', path: '/users', gate: 'none' },
  { method: 'POST', path: '/users/names', gate: 'none', body: { ids: [ID] } },
  { method: 'GET', path: '/users/system-property-keys', gate: 'none' },
  { method: 'GET', path: `/users/${ID}`, gate: 'none' },
  { method: 'POST', path: '/users', gate: 'builder', body: {} },
  { method: 'PUT', path: `/users/${ID}`, gate: 'builder', body: {} },
  { method: 'PATCH', path: `/users/${ID}/properties`, gate: 'builder', body: {} },
  { method: 'DELETE', path: `/users/${ID}`, gate: 'builder' },
  { method: 'GET', path: `/users/${ID}/roles`, gate: 'none' },
  { method: 'DELETE', path: `/users/${ID}/roles/sample-role`, gate: 'admin' },
  { method: 'GET', path: `/users/${ID}/personas`, gate: 'none' },
  { method: 'POST', path: `/users/${ID}/personas`, gate: 'roleManager', body: {} },
  { method: 'DELETE', path: `/users/${ID}/personas/sample-persona`, gate: 'roleManager' },

  // routes/roles.ts
  { method: 'GET', path: '/roles', gate: 'none' },
  { method: 'GET', path: '/roles/details', gate: 'none' },
  { method: 'POST', path: '/roles', gate: 'roleManager', body: {} },
  { method: 'GET', path: '/roles/escalation-chains', gate: 'none' },
  { method: 'POST', path: '/roles/escalation-chains', gate: 'roleManager', body: {} },
  { method: 'DELETE', path: '/roles/escalation-chains', gate: 'roleManager', body: {} },
  { method: 'PATCH', path: '/roles/sample-role', gate: 'roleManager', body: {} },
  { method: 'GET', path: '/roles/sample-role/schema', gate: 'none' },
  { method: 'GET', path: '/roles/sample-role/schema/versions', gate: 'none' },
  { method: 'GET', path: '/roles/sample-role/list-schema', gate: 'none' },
  { method: 'GET', path: '/roles/sample-role/list-schema/versions', gate: 'none' },
  { method: 'GET', path: '/roles/sample-role/escalation-targets', gate: 'none' },
  { method: 'PUT', path: '/roles/sample-role/escalation-targets', gate: 'roleManager', body: {} },
  { method: 'DELETE', path: '/roles/sample-role', gate: 'roleManager' },

  // routes/personas.ts (router-level gate)
  { method: 'GET', path: '/personas', gate: 'roleManager' },
  { method: 'POST', path: '/personas', gate: 'roleManager', body: {} },
  { method: 'POST', path: '/personas/seed', gate: 'roleManager', body: {} },
  { method: 'GET', path: '/personas/sample-persona', gate: 'roleManager' },
  { method: 'PATCH', path: '/personas/sample-persona', gate: 'roleManager', body: {} },
  { method: 'DELETE', path: '/personas/sample-persona', gate: 'roleManager' },
  { method: 'PUT', path: '/personas/sample-persona/roles/sample-role', gate: 'roleManager', body: {} },
  { method: 'DELETE', path: '/personas/sample-persona/roles/sample-role', gate: 'roleManager' },

  // routes/bot-accounts.ts (router-level gate)
  { method: 'GET', path: '/bot-accounts', gate: 'builder' },
  { method: 'GET', path: `/bot-accounts/${ID}`, gate: 'builder' },
  { method: 'POST', path: '/bot-accounts', gate: 'builder', body: {} },
  { method: 'PUT', path: `/bot-accounts/${ID}`, gate: 'builder', body: {} },
  { method: 'DELETE', path: `/bot-accounts/${ID}`, gate: 'builder' },
  { method: 'GET', path: `/bot-accounts/${ID}/roles`, gate: 'builder' },
  { method: 'POST', path: `/bot-accounts/${ID}/roles`, gate: 'builder', body: {} },
  { method: 'DELETE', path: `/bot-accounts/${ID}/roles/sample-role`, gate: 'builder' },
  { method: 'GET', path: `/bot-accounts/${ID}/api-keys`, gate: 'builder' },
  { method: 'POST', path: `/bot-accounts/${ID}/api-keys`, gate: 'builder', body: {} },
  { method: 'DELETE', path: `/bot-accounts/${ID}/api-keys/${ID}`, gate: 'builder' },

  // routes/workflows/config.ts
  { method: 'GET', path: '/workflows/config', gate: 'none' },
  { method: 'GET', path: '/workflows/sampleType/config', gate: 'none' },
  { method: 'GET', path: '/workflows/sampleType/input-lookups', gate: 'none' },
  { method: 'PUT', path: '/workflows/sampleType/config', gate: 'admin', body: {} },
  { method: 'DELETE', path: '/workflows/sampleType/config', gate: 'admin' },

  // routes/knowledge.ts (router-level gate, reads included)
  { method: 'GET', path: '/knowledge/domains', gate: 'builder' },
  { method: 'GET', path: '/knowledge/entries?domain=d', gate: 'builder' },
  { method: 'GET', path: '/knowledge/entry?domain=d&key=k', gate: 'builder' },
  { method: 'GET', path: '/knowledge/entry/versions?domain=d&key=k', gate: 'builder' },
  { method: 'POST', path: '/knowledge/entry', gate: 'builder', body: {} },
  { method: 'DELETE', path: '/knowledge/entry', gate: 'builder', body: {} },
  { method: 'PUT', path: '/knowledge/field', gate: 'builder', body: {} },
  { method: 'DELETE', path: '/knowledge/field', gate: 'builder', body: {} },

  // routes/domain.ts
  { method: 'GET', path: '/domain', gate: 'none' },
  { method: 'PUT', path: '/domain', gate: 'admin', body: {} },

  // routes/scan-codes.ts
  { method: 'POST', path: '/scan-codes/execute', gate: 'none', body: {} },
  { method: 'POST', path: '/scan-codes/execute-choice', gate: 'none', body: {} },
  { method: 'GET', path: '/scan-codes/schemes', gate: 'none' },
  { method: 'GET', path: '/scan-codes/schemes/1', gate: 'none' },
  { method: 'PUT', path: '/scan-codes/schemes/1', gate: 'roleManager', body: {} },
  { method: 'DELETE', path: '/scan-codes/schemes/1', gate: 'roleManager' },
  { method: 'GET', path: '/scan-codes/schemes/1/actions', gate: 'none' },
  { method: 'GET', path: '/scan-codes/schemes/1/actions/sample', gate: 'none' },
  { method: 'PUT', path: '/scan-codes/schemes/1/actions/sample', gate: 'roleManager', body: {} },
  { method: 'DELETE', path: '/scan-codes/schemes/1/actions/sample', gate: 'roleManager' },

  // routes/announcements.ts
  { method: 'GET', path: '/announcements', gate: 'none' },
  { method: 'POST', path: '/announcements', gate: 'roleManager', body: {} },
  { method: 'DELETE', path: `/announcements/${ID}`, gate: 'roleManager' },

  // routes/maintenance.ts
  { method: 'GET', path: '/config/maintenance', gate: 'none' },
  { method: 'PUT', path: '/config/maintenance', gate: 'admin', body: {} },

  // routes/dba.ts
  { method: 'POST', path: '/dba/prune', gate: 'admin', body: {} },
  { method: 'POST', path: '/dba/deploy', gate: 'admin', body: {} },

  // routes/diagnostics.ts
  { method: 'GET', path: '/diagnostics/jobs/sample-workflow', gate: 'admin' },
  { method: 'GET', path: '/diagnostics/stalled', gate: 'admin' },
  { method: 'GET', path: '/diagnostics/orphaned-signals', gate: 'admin' },

  // routes/controlplane.ts
  { method: 'GET', path: '/controlplane/apps', gate: 'builder' },
  { method: 'GET', path: '/controlplane/rollcall', gate: 'builder' },
  { method: 'POST', path: '/controlplane/throttle', gate: 'builder', body: {} },
  { method: 'GET', path: '/controlplane/streams', gate: 'builder' },
  { method: 'GET', path: '/controlplane/stream-messages', gate: 'builder' },
  { method: 'POST', path: '/controlplane/subscribe', gate: 'builder', body: {} },
];
