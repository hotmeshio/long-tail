/**
 * Fleet-sim seed — the persona-views reference example. Declares the
 * `fleet-servicer` role and seeds one advert escalation per machine, so the
 * whole story is exercisable from the dashboard without code changes:
 *
 *   - facet-board list schema: one card per machine (x-lt-group-by on
 *     metadata.fleetMachine), state chip from metadata.machineState, and a
 *     format:"age" field showing how long the machine has sat in that state
 *   - role default_pins: the servicer's starting bookmark set — the board,
 *     a badged "Needs harvesting" query, and a badged jeopardy view
 *   - priority dials: finished machines older than 30 minutes count as
 *     in jeopardy, so the pins' counts and the Pace Board agree
 *
 * Each machine advertises ONE pending escalation carrying its current state —
 * the digital-twin pattern: the row is the machine's live advert, and its
 * metadata facets are what the servicer queries, pins, and boards.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { createEscalation, listEscalations } from '../services/escalation';
import { loggerRegistry } from '../lib/logger';

export const FLEET_ROLE = 'fleet-servicer';

const FLEET_LIST_SCHEMA = {
  'x-lt-layout': 'facet-board',
  'x-lt-group-by': 'metadata.fleetMachine',
  'x-lt-help': [
    '# Fleet board',
    '',
    'One card per machine, showing its latest advertised state. Click a card to',
    'open its latest item; hover for the machine\'s history (table or timeline);',
    '⇧ click filters the board. **finished** machines need harvesting.',
  ].join('\n'),
  'x-lt-card': {
    title: '{{metadata.fleetMachine}}',
    state: '{{metadata.machineState}}',
    fields: [
      { label: 'PO', value: '{{metadata.po}}' },
      { label: 'Order', value: '{{metadata.orderId}}' },
      { label: 'Since', value: '{{escalation.created_at}}', format: 'age' },
    ],
  },
};

const FLEET_DEFAULT_PINS = [
  { label: 'Fleet board', url: `/escalations/available?role=${FLEET_ROLE}&view=rich` },
  {
    label: 'Needs harvesting',
    url: `/escalations/available?role=${FLEET_ROLE}&facets=${encodeURIComponent(JSON.stringify({ machineState: 'finished' }))}&view=table`,
    badge: true,
  },
  { label: 'In jeopardy', url: `/escalations/available?role=${FLEET_ROLE}&jeopardy=1&view=table`, badge: true },
];

export async function seedFleetSimRole(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(FLEET_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  const row = existing.get(FLEET_ROLE);
  const unconfigured = row != null && row.title == null;
  if (!created && !unconfigured) {
    loggerRegistry.info(`[examples] fleet-sim role ${FLEET_ROLE} already configured, skipping`);
    return;
  }

  try {
    await updateRoleMetadata(FLEET_ROLE, {
      title: 'Fleet Servicer',
      description: 'Services the machine fleet — the reference example for persona views: facet-board list schema, role default pins, and jeopardy dials.',
      ops_visible: false,
      parent_role: null,
      sla_minutes: 60,
      priority_threshold_minutes: 30,
      list_schema: FLEET_LIST_SCHEMA,
      default_pins: FLEET_DEFAULT_PINS,
    });
    loggerRegistry.info(`[examples] fleet-sim role verified (${FLEET_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update fleet-sim role ${FLEET_ROLE}: ${err.message}`);
  }
}

/** One pending advert per machine unless the fleet already has rows. */
export async function seedFleetSimEscalations(): Promise<void> {
  try {
    const { escalations: existing } = await listEscalations({
      role: FLEET_ROLE,
      status: 'pending',
      limit: 1,
    });
    if (existing.length > 0) {
      loggerRegistry.info('[examples] fleet-sim escalations already exist, skipping');
      return;
    }

    const machines = [
      { fleetMachine: 'M-01', machineState: 'printing', po: 'PO-1041', orderId: 'ord-7301' },
      { fleetMachine: 'M-02', machineState: 'finished', po: 'PO-1038', orderId: 'ord-7288' },
      { fleetMachine: 'M-03', machineState: 'idle', po: '', orderId: '' },
      { fleetMachine: 'M-04', machineState: 'finished', po: 'PO-1035', orderId: 'ord-7264' },
      { fleetMachine: 'M-05', machineState: 'homing', po: 'PO-1042', orderId: 'ord-7305' },
    ];

    for (const m of machines) {
      await createEscalation({
        type: 'fleet',
        subtype: m.machineState,
        description: `${m.fleetMachine} — ${m.machineState}`,
        priority: m.machineState === 'finished' ? 1 : 3,
        role: FLEET_ROLE,
        envelope: JSON.stringify({ source: 'fleet-sim' }),
        metadata: m,
      });
    }
    loggerRegistry.info(`[examples] fleet-sim machine adverts seeded (${machines.length})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed fleet-sim escalations: ${err.message}`);
  }
}
