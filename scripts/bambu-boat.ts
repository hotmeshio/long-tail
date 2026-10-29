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
 *    OrcaSlicer system preset name or a path to a preset JSON; a process or
 *    filament preset of your own is marked compatible with the printer.
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

/** A preset by path, or by the name of a system preset in ORCA_PROFILES. */
function presetPath(kind: keyof typeof PRESET_DIR, value: string): string {
  if (existsSync(value)) return resolve(value);
  const path = join(PROFILES, PRESET_DIR[kind], `${value}.json`);
  if (!existsSync(path)) throw new Error(`no ${kind.toLowerCase()} preset ${value} (a path, or a name in ${PROFILES}/${PRESET_DIR[kind]})`);
  return path;
}

/** A preset of your own, copied as compatible with the printer, which OrcaSlicer requires before it slices. */
function compatible(path: string, printerName: string, dir: string): string {
  const preset = JSON.parse(readFileSync(path, 'utf8'));
  if (preset.from === 'system') return path;
  const copy = join(dir, `${preset.type}.json`);
  writeFileSync(copy, JSON.stringify({ ...preset, compatible_printers: [printerName] }));
  return copy;
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
  const printer = presetPath('PRINTER', PRESET.PRINTER);
  const printerName = JSON.parse(readFileSync(printer, 'utf8')).name;
  const process_ = compatible(presetPath('PROCESS', PRESET.PROCESS), printerName, work);
  const filament = compatible(presetPath('FILAMENT', PRESET.FILAMENT), printerName, work);
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
