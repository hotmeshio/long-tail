/**
 * Make the example's first print: a small 3DBenchy (by Creative Tools), sliced
 * for the printer with OrcaSlicer, written to examples/workflows/bambu-printer/files/boat.gcode.3mf.
 * Run it on the host, where OrcaSlicer is installed:
 *
 *   npm run bambu:boat
 *
 * 1. Download the model once into files/.
 * 2. Scale it (BAMBU_BOAT_SCALE, 0.5 by default: about ten minutes on a P1S).
 * 3. Slice it with the printer, process and filament presets. Each is an
 *    OrcaSlicer system preset name or a path to a preset JSON, which may
 *    inherit a system preset by name.
 *
 * Env: BAMBU_BOAT_PRINTER, BAMBU_BOAT_PROCESS, BAMBU_BOAT_FILAMENT, BAMBU_BOAT_SCALE,
 * ORCA_SLICER (the OrcaSlicer executable) and ORCA_PROFILES (its BBL profiles directory).
 */

try { require('dotenv/config'); } catch { /* dotenv optional */ }

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const env = process.env;
const FILES = resolve('examples/workflows/bambu-printer/files');
const MODEL_URL = 'https://raw.githubusercontent.com/CreativeTools/3DBenchy/master/Single-part/3DBenchy.stl';
const ORCA = env.ORCA_SLICER || '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer';
const PROFILES = env.ORCA_PROFILES || '/Applications/OrcaSlicer.app/Contents/Resources/profiles/BBL';
const PRESET = {
  PRINTER: env.BAMBU_BOAT_PRINTER || 'Bambu Lab P1S 0.4 nozzle',
  PROCESS: env.BAMBU_BOAT_PROCESS || '0.20mm Standard @BBL X1C',
  FILAMENT: env.BAMBU_BOAT_FILAMENT || 'Bambu PLA Basic @BBL X1C',
};
const PRESET_DIR = { PRINTER: 'machine', PROCESS: 'process', FILAMENT: 'filament' } as const;
const STL_HEADER = 84;
const STL_TRIANGLE = 50;

const say = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function fetchModel(): Promise<string> {
  const path = join(FILES, '3DBenchy.stl');
  if (existsSync(path)) return path;
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`GET ${MODEL_URL} -> ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

/** A binary STL with every vertex scaled about the origin; the slicer places it on the bed. */
function scaleStl(stl: Buffer, factor: number): Buffer {
  const count = stl.readUInt32LE(STL_HEADER - 4);
  if (stl.length !== STL_HEADER + count * STL_TRIANGLE) throw new Error('the model is not a binary STL');
  const out = Buffer.from(stl);
  for (let t = 0; t < count; t++) {
    const at = STL_HEADER + t * STL_TRIANGLE;
    for (let v = 3; v < 12; v++) out.writeFloatLE(stl.readFloatLE(at + v * 4) * factor, at + v * 4);
  }
  return out;
}

type Preset = Record<string, any>;
type PresetKind = keyof typeof PRESET_DIR;

/** The system presets of one kind in ORCA_PROFILES, by name. */
function systemPresets(kind: PresetKind): Map<string, Preset> {
  const dir = join(PROFILES, PRESET_DIR[kind]);
  const byName = new Map<string, Preset>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const preset = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (preset.name) byName.set(preset.name, preset);
  }
  return byName;
}

/**
 * A preset by path or system preset name, with every setting it inherits
 * written out: OrcaSlicer's command line reads only the keys in the file, so
 * an inherited start, layer-change or end G-code would otherwise be lost.
 */
function fullPreset(kind: PresetKind, value: string): Preset {
  const system = systemPresets(kind);
  const own = existsSync(value) ? JSON.parse(readFileSync(value, 'utf8')) : system.get(value);
  if (!own) throw new Error(`no ${kind.toLowerCase()} preset ${value} (a path, or a name in ${PROFILES}/${PRESET_DIR[kind]})`);
  const chain: Preset[] = [own];
  for (let p = own; p.inherits; ) {
    p = system.get(p.inherits)!;
    if (!p) throw new Error(`${kind.toLowerCase()} preset ${value} inherits ${chain[chain.length - 1].inherits}, which is not in ${PROFILES}`);
    chain.unshift(p);
  }
  return Object.assign({}, ...chain, { inherits: '' });
}

/** Write a full preset for the slicer; a process or filament is marked compatible with the printer, as OrcaSlicer requires. */
function writePreset(dir: string, kind: PresetKind, preset: Preset, printerName: string): string {
  const path = join(dir, `${PRESET_DIR[kind]}.json`);
  const compatibility = kind === 'PRINTER' ? {} : { from: 'User', compatible_printers: [printerName], compatible_printers_condition: '' };
  writeFileSync(path, JSON.stringify({ ...preset, ...compatibility }));
  return path;
}

async function main(): Promise<void> {
  if (!existsSync(ORCA)) throw new Error(`OrcaSlicer is not at ${ORCA}; install it or set ORCA_SLICER`);
  mkdirSync(FILES, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'bambu-boat-'));

  // 1. The model
  const model = await fetchModel();

  // 2. Scaled
  const scale = Number(env.BAMBU_BOAT_SCALE || 0.5);
  if (!(scale > 0)) throw new Error(`BAMBU_BOAT_SCALE="${env.BAMBU_BOAT_SCALE}" must be a number above 0`);
  const scaled = join(work, 'boat.stl');
  writeFileSync(scaled, scaleStl(readFileSync(model), scale));

  // 3. Sliced
  const printerPreset = fullPreset('PRINTER', PRESET.PRINTER);
  const printerName: string = printerPreset.name;
  const printer = writePreset(work, 'PRINTER', printerPreset, printerName);
  const process_ = writePreset(work, 'PROCESS', fullPreset('PROCESS', PRESET.PROCESS), printerName);
  const filament = writePreset(work, 'FILAMENT', fullPreset('FILAMENT', PRESET.FILAMENT), printerName);
  say(`slicing at ${scale}x for ${printerName}`);
  execFileSync(ORCA, [
    '--load-settings', `${printer};${process_}`, '--load-filaments', filament,
    '--arrange', '1', '--slice', '0', '--outputdir', work, '--export-3mf', 'boat.gcode.3mf', scaled,
  ], { stdio: 'inherit' });

  const target = join(FILES, 'boat.gcode.3mf');
  renameSync(join(work, 'boat.gcode.3mf'), target);
  const gcode = readdirSync(work).find((f) => f.endsWith('.gcode'));
  const time = gcode ? readFileSync(join(work, gcode), 'utf8').slice(0, 2000).match(/total estimated time: ([^\n]+)/)?.[1] : undefined;
  say(`${target}${time ? ` (about ${time})` : ''}`);
}

main().catch((err) => {
  console.error(`failed: ${err.message}`);
  process.exit(1);
});
