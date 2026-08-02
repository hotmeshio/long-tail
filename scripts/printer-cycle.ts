/**
 * printer-cycle — drive the seeded printer fleet through its states live.
 *
 * The flagship entity-analytics demo (examples/seed-fleet-sim.ts) seeds six
 * printers with backdated history and one open interval each. This driver
 * keeps the fleet moving: each printer dwells in its current state, then the
 * open escalation resolves and the next state's escalation is created after a
 * short untracked settle gap — exactly the authoring contract a real workflow
 * follows with condition(). Watch /operations: the state band, slice-by, and
 * per-printer timelines move within seconds of every transition.
 *
 * State machine per printer:  idle → printing → harvest → (service |) idle …
 *
 * Usage:
 *   npx ts-node scripts/printer-cycle.ts
 *   DWELL_SCALE=0.2 npx ts-node scripts/printer-cycle.ts   (5× faster)
 *
 * Env vars:
 *   DWELL_SCALE — multiply every dwell/gap (default 1; smaller = faster demo)
 *   CYCLES      — stop after each printer completes this many transitions
 *                 (default: run until interrupted)
 *   POLL_MS     — poll interval ms (default 1000)
 *   BASE_URL    — server URL (default http://localhost:3000)
 */

export {}; // module scope — the driver shares its env-var names with sibling scripts

try { require('dotenv/config'); } catch {}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DWELL_SCALE = parseFloat(process.env.DWELL_SCALE || '1');
const CYCLES = parseInt(process.env.CYCLES || '0', 10);
const POLL_MS = parseInt(process.env.POLL_MS || '1000', 10);

const FLEET_ROLE = 'printer-fleet';
const HARVEST_ROLE = 'printer-harvest';
const SERVICE_ROLE = 'printer-service';
const ROLES = [FLEET_ROLE, HARVEST_ROLE, SERVICE_ROLE];
const ENTITY_FACET = 'serialNumber';

/** Seconds a printer dwells in each state (before DWELL_SCALE and jitter). */
const DWELL_S: Record<string, number> = { idle: 45, printing: 120, harvest: 20, service: 60 };
const GAP_S = 5; // untracked settle time between queues

interface StateDef { role: string; subtype: string }
const STATES: Record<string, StateDef> = {
  idle: { role: FLEET_ROLE, subtype: 'idle' },
  printing: { role: FLEET_ROLE, subtype: 'printing' },
  harvest: { role: HARVEST_ROLE, subtype: 'harvest' },
  service: { role: SERVICE_ROLE, subtype: 'service' },
};

let token = '';
let transitions = 0;

function ts(): string { return new Date().toISOString().slice(11, 19); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function ageSeconds(iso: string): number { return (Date.now() - new Date(iso).getTime()) / 1000; }

/** Deterministic per-row jitter in [0, 1) — FNV-1a of the escalation id. */
function jitter(id: string, salt: string): number {
  let h = 2166136261;
  for (const c of salt + id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function login() {
  const auth = await api('POST', '/api/auth/login', { username: 'superadmin', password: 'l0ngt@1l' });
  token = auth.token;
  if (!token) { console.error('[auth] Login failed'); process.exit(1); }
  console.log(`[${ts()}] Logged in`);
}

/** Self-heal the entity dials: declare where unset, never overwrite (S2). */
async function ensureEntityDials(): Promise<void> {
  const details = await api('GET', '/api/roles/details').catch(() => ({ roles: [] }));
  const byRole = new Map<string, any>((details?.roles ?? []).map((r: any) => [r.role, r]));
  for (const role of ROLES) {
    const row = byRole.get(role);
    if (!row) {
      console.error(`[${ts()}] role ${role} is missing — run the seeded install first (docker compose up with examples)`);
      process.exit(1);
    }
    if (row.entity_facet == null) {
      await api('PATCH', `/api/roles/${role}`, {
        entity_facet: ENTITY_FACET,
        entity_state_source: role === FLEET_ROLE ? 'subtype' : 'role',
      }).catch(() => { /* concurrent heal */ });
      console.log(`[${ts()}] declared entity dials on ${role}`);
    }
  }
}

/** The state a printer enters after `current` — service follows ~⅓ of harvests. */
function nextState(current: string, rowId: string): string {
  if (current === 'idle') return 'printing';
  if (current === 'printing') return 'harvest';
  if (current === 'harvest') return jitter(rowId, 'svc') < 0.33 ? 'service' : 'idle';
  return 'idle'; // service → back to the floor
}

async function transition(row: any): Promise<void> {
  const serial = row.metadata?.[ENTITY_FACET];
  const current = row.role === FLEET_ROLE ? row.subtype : row.role === HARVEST_ROLE ? 'harvest' : 'service';
  const next = nextState(current, row.id);
  await api('POST', `/api/escalations/${row.id}/resolve`, {
    resolverPayload: { outcome: current, driver: 'printer-cycle' },
  });
  await sleep(GAP_S * DWELL_SCALE * 1000 * (0.5 + jitter(row.id, 'gap')));
  const def = STATES[next];
  await api('POST', '/api/escalations', {
    type: 'fleet',
    subtype: def.subtype,
    role: def.role,
    description: `${serial} — ${next}`,
    priority: 3,
    envelope: JSON.stringify({ source: 'printer-cycle' }),
    metadata: { ...row.metadata },
  });
  transitions++;
  console.log(`[${ts()}] ${serial}: ${current} → ${next}`);
}

/** Every live printer interval across the three queues. */
async function liveRows(): Promise<any[]> {
  const params = new URLSearchParams({
    status: 'pending',
    roles: JSON.stringify(ROLES),
    exists: JSON.stringify([ENTITY_FACET]),
    limit: '200',
  });
  const data = await api('GET', `/api/escalations?${params}`);
  return data.escalations ?? [];
}

async function main() {
  console.log(`[${ts()}] printer-cycle starting (scale ${DWELL_SCALE}, ${CYCLES || '∞'} transitions/printer)`);
  await login();
  await ensureEntityDials();

  const perPrinterCap = CYCLES > 0 ? CYCLES * 6 : Infinity; // 6 seeded printers
  while (transitions < perPrinterCap) {
    const rows = await liveRows();
    if (rows.length === 0) {
      console.log(`[${ts()}] no live printer intervals — seed the fleet first`);
      break;
    }
    for (const row of rows) {
      const state = row.role === FLEET_ROLE ? row.subtype : row.role === HARVEST_ROLE ? 'harvest' : 'service';
      const dwell = (DWELL_S[state] ?? 30) * DWELL_SCALE * (0.6 + 0.8 * jitter(row.id, 'dwell'));
      if (ageSeconds(row.created_at) >= dwell) {
        await transition(row).catch((err) => console.error(`[${ts()}] transition failed: ${String(err.message).slice(0, 100)}`));
      }
    }
    await sleep(POLL_MS);
  }
  console.log(`[${ts()}] done — ${transitions} transitions`);
}

main().catch((err) => { console.error(err); process.exit(1); });
