/**
 * Printer-fleet seed — the flagship entity-analytics example. A print farm's
 * printers move through three queues, and each escalation is one interval the
 * printer spends in one state:
 *
 *   printer-fleet    idle | printing   (two states in one role — subtypes)
 *   printer-harvest  being harvested   (the role is the state)
 *   printer-service  being serviced    (the role is the state)
 *
 * Every row carries metadata.serialNumber (the printer) plus categorical
 * facts to slice by: model (p1s | h2s), pdac, foaming. The three roles share
 * entity_facet 'serialNumber', so together they form the printer's SYSTEM —
 * `query.entity: 'serialNumber'` + `groupBy.state: true` answers "how did the
 * printers spend their time" in one call, and /operations renders it as the
 * fleet's state band.
 *
 * Seeding produces both the live fleet (one open interval per printer) and a
 * few hours of backdated terminal history, so the analytics band is readable
 * on a fresh install without running a driver. Timestamp backdating touches
 * only rows this seeder just created — demo data, not a write path.
 *
 * Role dials self-heal: a role configured before the dials existed gets its
 * entity declaration filled in; values an operator already set are never
 * overwritten.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { createEscalation, resolveEscalation, countByFacets } from '../services/escalation';
import { getPool } from '../lib/db';
import { loggerRegistry } from '../lib/logger';

export const PRINTER_FLEET_ROLE = 'printer-fleet';
export const PRINTER_HARVEST_ROLE = 'printer-harvest';
export const PRINTER_SERVICE_ROLE = 'printer-service';
export const PRINTER_ENTITY_FACET = 'serialNumber';

const FLEET_LIST_SCHEMA = {
  'x-lt-layout': 'facet-board',
  'x-lt-group-by': `metadata.${PRINTER_ENTITY_FACET}`,
  'x-lt-help': [
    '# Printer fleet board',
    '',
    'One card per printer, showing its live state (idle or printing). Click a',
    'card to open its latest item; the value menu on any serial number offers',
    'filter, search, and the printer\'s full cross-queue timeline.',
  ].join('\n'),
  'x-lt-card': {
    title: `{{metadata.${PRINTER_ENTITY_FACET}}}`,
    state: '{{escalation.subtype}}',
    fields: [
      { label: 'Model', value: '{{metadata.model}}' },
      { label: 'Since', value: '{{escalation.created_at}}', format: 'age' },
    ],
  },
  'x-lt-row-action': { action: 'claim', label: 'Attend', durationMinutes: 60 },
};

const FLEET_DEFAULT_PINS = [
  { label: 'Fleet board', url: `/escalations/available?role=${PRINTER_FLEET_ROLE}&view=rich` },
  { label: 'Harvest queue', url: `/escalations/available?role=${PRINTER_HARVEST_ROLE}&view=table`, badge: true },
  { label: 'In jeopardy', url: `/escalations/available?role=${PRINTER_FLEET_ROLE}&jeopardy=1&view=table`, badge: true },
];

interface PrinterRoleData {
  role: string;
  title: string;
  description: string;
  parent_role: string | null;
  sla_minutes: number;
  entity_state_source: 'role' | 'subtype';
  list_schema?: Record<string, any>;
  default_pins?: { label: string; url: string; badge?: boolean }[];
  // Fronts a locked station viewport. The shared 'station' login is a read-only
  // member of all three, so it picks which of these is its kiosk home.
  kiosk?: boolean;
}

const PRINTER_ROLE_DATA: PrinterRoleData[] = [
  {
    role: PRINTER_FLEET_ROLE,
    title: 'Printer Fleet',
    description: 'The printers at work — idle and printing intervals, one live advert per machine.',
    parent_role: null,
    sla_minutes: 60,
    entity_state_source: 'subtype',
    list_schema: FLEET_LIST_SCHEMA,
    default_pins: FLEET_DEFAULT_PINS,
    kiosk: true,
  },
  {
    role: PRINTER_HARVEST_ROLE,
    title: 'Print Harvest',
    description: 'Finished prints waiting to be pulled — being in this queue is the state.',
    parent_role: PRINTER_FLEET_ROLE,
    sla_minutes: 15,
    entity_state_source: 'role',
    kiosk: true,
  },
  {
    role: PRINTER_SERVICE_ROLE,
    title: 'Printer Service',
    description: 'Machines under maintenance — being in this queue is the state.',
    parent_role: PRINTER_FLEET_ROLE,
    sla_minutes: 45,
    entity_state_source: 'role',
    kiosk: true,
  },
];

export async function seedPrinterFleetRoles(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  const createdRoles = new Set<string>();
  for (const data of PRINTER_ROLE_DATA) {
    try {
      if (await createRole(data.role)) createdRoles.add(data.role);
    } catch { /* ON CONFLICT DO NOTHING */ }
  }

  for (const data of PRINTER_ROLE_DATA) {
    const row = existing.get(data.role);
    const unconfigured = row != null && row.title == null;
    try {
      if (createdRoles.has(data.role) || unconfigured) {
        await updateRoleMetadata(data.role, {
          title: data.title,
          description: data.description,
          ops_visible: true,
          parent_role: data.parent_role,
          sla_minutes: data.sla_minutes,
          priority_threshold_minutes: data.sla_minutes,
          entity_facet: PRINTER_ENTITY_FACET,
          entity_state_source: data.entity_state_source,
          ...(data.list_schema ? { list_schema: data.list_schema } : {}),
          ...(data.default_pins ? { default_pins: data.default_pins } : {}),
        });
      } else if (row != null && row.entity_facet == null) {
        // Self-heal: the role predates the dials (or another seeder configured
        // it) — declare the entity without touching the operator's other values.
        await updateRoleMetadata(data.role, {
          entity_facet: PRINTER_ENTITY_FACET,
          entity_state_source: data.entity_state_source,
        });
      }
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update printer role ${data.role}: ${err.message}`);
    }
  }
  // Flag the station queues as kiosk homes, merging so an operator's other
  // properties survive. Idempotent: skips a role that already carries the flag.
  const details = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));
  for (const data of PRINTER_ROLE_DATA) {
    if (!data.kiosk) continue;
    const props = (details.get(data.role)?.properties ?? {}) as Record<string, unknown>;
    if (props.kiosk === true) continue;
    try {
      await updateRoleMetadata(data.role, { properties: { ...props, kiosk: true } });
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to flag kiosk on ${data.role}: ${err.message}`);
    }
  }

  loggerRegistry.info(
    `[examples] printer roles verified (${PRINTER_ROLE_DATA.map((d) => d.role).join(', ')})`,
  );
}

// ── The fleet and its history ─────────────────────────────────────────────────

const PRINTERS = [
  { serialNumber: 'PRN-001', model: 'p1s', pdac: true, foaming: false },
  { serialNumber: 'PRN-002', model: 'p1s', pdac: false, foaming: true },
  { serialNumber: 'PRN-003', model: 'p1s', pdac: false, foaming: false },
  { serialNumber: 'PRN-004', model: 'h2s', pdac: true, foaming: true },
  { serialNumber: 'PRN-005', model: 'h2s', pdac: true, foaming: false },
  { serialNumber: 'PRN-006', model: 'h2s', pdac: false, foaming: false },
];

/** One printer state as (role, subtype) — the row vocabulary of §"the contract". */
const STATES = {
  idle: { role: PRINTER_FLEET_ROLE, subtype: 'idle' },
  printing: { role: PRINTER_FLEET_ROLE, subtype: 'printing' },
  harvest: { role: PRINTER_HARVEST_ROLE, subtype: 'harvest' },
  service: { role: PRINTER_SERVICE_ROLE, subtype: 'service' },
} as const;
type StateName = keyof typeof STATES;

const MINUTE = 60_000;
const HISTORY_HOURS = 6;

/** Deterministic per-printer/cycle variation — the demo reads the same on every install. */
function vary(base: number, i: number, c: number, salt: number): number {
  return Math.round(base * (0.7 + 0.6 * (((i * 7 + c * 13 + salt * 29) % 10) / 10)));
}

/**
 * A printer's day, walked forward from HISTORY_HOURS ago: idle → printing →
 * harvest (→ service on some cycles) with a few minutes of untracked time
 * between queues — the settle gap the timeline preserves. The final interval
 * stays open as the printer's live state.
 */
function planIntervals(i: number): Array<{ state: StateName; start: Date; end: Date | null }> {
  const out: Array<{ state: StateName; start: Date; end: Date | null }> = [];
  let t = Date.now() - HISTORY_HOURS * 60 * MINUTE;
  let c = 0;
  const cycle: StateName[] = ['idle', 'printing', 'harvest'];
  while (t < Date.now() - 10 * MINUTE) {
    const withService = (i + c) % 3 === 2;
    const states: StateName[] = withService ? [...cycle, 'service'] : cycle;
    for (const state of states) {
      const minutes =
        state === 'idle' ? vary(25, i, c, 1)
        : state === 'printing' ? vary(65, i, c, 2)
        : state === 'harvest' ? vary(10, i, c, 3)
        : vary(35, i, c, 4);
      const start = new Date(t);
      const end = new Date(t + minutes * MINUTE);
      if (end.getTime() >= Date.now()) {
        out.push({ state, start, end: null }); // the live interval
        return out;
      }
      out.push({ state, start, end });
      t = end.getTime() + vary(3, i, c, 5) * MINUTE; // untracked settle gap
    }
    c++;
  }
  // The walk ended between cycles — park the printer idle, live.
  out.push({ state: 'idle', start: new Date(t), end: null });
  return out;
}

const BACKDATE_SQL = `
  UPDATE public.hmsh_escalations AS e SET
    created_at  = v.created_at,
    resolved_at = CASE WHEN e.status = 'resolved' THEN v.ended_at ELSE e.resolved_at END,
    updated_at  = COALESCE(v.ended_at, e.updated_at)
  FROM (
    SELECT unnest($1::uuid[]) AS id,
           unnest($2::timestamptz[]) AS created_at,
           unnest($3::timestamptz[]) AS ended_at
  ) v
  WHERE e.id = v.id`;

/** The fleet's intervals — skipped when the fleet already has rows. */
export async function seedPrinterFleetEscalations(): Promise<void> {
  try {
    const seeded = await countByFacets({
      role: PRINTER_FLEET_ROLE,
      exists: [PRINTER_ENTITY_FACET],
    });
    if (seeded > 0) {
      loggerRegistry.info('[examples] printer-fleet intervals already exist, skipping');
      return;
    }

    const ids: string[] = [];
    const starts: string[] = [];
    const ends: (string | null)[] = [];
    for (let i = 0; i < PRINTERS.length; i++) {
      for (const interval of planIntervals(i)) {
        const { role, subtype } = STATES[interval.state];
        const row = await createEscalation({
          type: 'fleet',
          subtype,
          description: `${PRINTERS[i].serialNumber} — ${interval.state}`,
          priority: 3,
          role,
          envelope: JSON.stringify({ source: 'printer-fleet-seed' }),
          metadata: { ...PRINTERS[i] },
        });
        if (!row) continue;
        if (interval.end != null) {
          await resolveEscalation(row.id, { outcome: interval.state, seeded: true });
        }
        ids.push(row.id);
        starts.push(interval.start.toISOString());
        ends.push(interval.end ? interval.end.toISOString() : null);
      }
    }

    await getPool().query(BACKDATE_SQL, [ids, starts, ends]);
    loggerRegistry.info(
      `[examples] printer fleet seeded (${PRINTERS.length} printers, ${ids.length} intervals)`,
    );
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed printer fleet: ${err.message}`);
  }
}
