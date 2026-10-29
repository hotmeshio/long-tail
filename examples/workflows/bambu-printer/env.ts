/**
 * The printers, from the environment (.env). Each station is listed in
 * BAMBU_PRINTERS and described by BAMBU_<STATION>_* variables, the station
 * upper-cased with `-` as `_`:
 *
 *   BAMBU_SITE_ID=site-1         the site and line the printers form
 *   BAMBU_LINE_ID=print-1
 *   BAMBU_PRINTERS=p1s-01,h2s-01
 *   BAMBU_P1S_01_SERIAL=...      the printer's serial (its MQTT topic level)
 *   BAMBU_P1S_01_HOST=...        its LAN address
 *   BAMBU_P1S_01_CODE=...        its LAN access code
 *   BAMBU_P1S_01_ENABLED=true    only enabled printers are bridged and on the line
 *
 * A printer takes commands from Long Tail only with LAN Only and Developer
 * Mode turned on at the printer.
 */

import type { LineDef, MachineDef } from '../../../types/machines';
import { assertTopicLevel } from '../../../lib/machines/protocol';

export interface BambuPrinter {
  station: string;
  serial: string;
  host: string;
  code: string;
  enabled: boolean;
}

/** How a printer on the LAN is reached: its MQTT broker, its FTPS storage, and the user both take with its access code. */
export const PRINTER_ACCESS = {
  USER: 'bblp', MQTT_PORT: 8883, FTPS_PORT: 990, CACHE_DIR: 'cache', CACHE_URL: 'file:///sdcard/cache',
  /** The printer's own topics are `device/<serial>/report` and `device/<serial>/request`. */
  TOPIC_ROOT: 'device',
} as const;

export const BAMBU_ROLES = { UNLOAD: 'print-unload', SERVICING: 'print-servicing' } as const;
export const PRINT_PROCESS = 'print';
export const PRINT_RECIPE = { id: 'print-file', version: '1' } as const;

type Env = Record<string, string | undefined>;

const prefixOf = (station: string) => `BAMBU_${station.toUpperCase().replace(/-/g, '_')}_`;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set; see examples/workflows/bambu-printer/README.md`);
  return value;
}

export function printersFromEnv(env: Env = process.env): BambuPrinter[] {
  const stations = (env.BAMBU_PRINTERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!stations.length) throw new Error('BAMBU_PRINTERS is not set; see examples/workflows/bambu-printer/README.md');
  return stations.map((station) => {
    assertTopicLevel('station', station);
    const p = prefixOf(station);
    const serial = required(env, `${p}SERIAL`);
    assertTopicLevel(`${p}SERIAL`, serial);
    return { station, serial, host: required(env, `${p}HOST`), code: required(env, `${p}CODE`), enabled: env[`${p}ENABLED`] === 'true' };
  });
}

function printerDef(p: BambuPrinter): MachineDef {
  return {
    machineId: p.station,
    address: p.serial,
    process: PRINT_PROCESS,
    description: `Bambu printer ${p.station}`,
    carrier: 'none',
    cycleSec: 3600,
    changeoverSec: 0,
    rejectReason: 'PRINT-FAILED',
    recipes: { [PRINT_RECIPE.id]: [PRINT_RECIPE.version] },
    materials: [],
    measurements: [],
    faults: {},
    queueDepth: 1,
    requireArtifact: true,
  };
}

/** The line of enabled printers: one print station each, a person unloads, a person services. */
export function bambuLine(printers: BambuPrinter[], env: Env = process.env): LineDef {
  const enabled = printers.filter((p) => p.enabled);
  if (!enabled.length) throw new Error('no printer is enabled; set BAMBU_<STATION>_ENABLED=true for one');
  return {
    siteId: required(env, 'BAMBU_SITE_ID'),
    lineId: required(env, 'BAMBU_LINE_ID'),
    roles: { exit: BAMBU_ROLES.UNLOAD, operator: BAMBU_ROLES.SERVICING },
    machines: enabled.map(printerDef),
  };
}
