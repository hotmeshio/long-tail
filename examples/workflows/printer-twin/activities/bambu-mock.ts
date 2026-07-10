/**
 * In-repo mock of the Bambu Farm Manager — a deterministic, in-memory TS
 * simulation that mirrors the Python `bambu_config/mock_server_reference/server.py`
 * semantics: the same print state machine (IDLE → PREPARE → RUNNING → FINISH |
 * FAILED | PAUSE), the same command guards, and the same deliberate real-world
 * gaps (offline is silent, stop/bed_clean flip state without any event). Print
 * outcome is deterministic — armed per printer (tests) or carried on the job
 * (`simOutcome`, the driver) — so every reconcile branch is reachable with no
 * network. Swapped for the real server via the `http` backend, config only.
 *
 * This is plain activity code (not a workflow), so wall-clock time is fine.
 */

import { FILAMENT_HMS, type BambuGcodeState, type BambuHms, type BambuPollResult, type SimOutcome } from '../mirror';

const FAULT_HMS: BambuHms = { attr: 1, code: 2, action: 0, timestamp: 0 };

// Read lazily so tests/driver can tune print timing per run.
const prepareMs = (): number => Number(process.env.MOCK_PREPARE_MS ?? 800);
const printMs = (): number =>
  Number(process.env.MOCK_PRINT_MS ?? Number(process.env.MOCK_PRINT_SECONDS ?? 3) * 1000);

interface MockPrinter {
  sn: string;
  model: string;
  name: string;
  ip: string;
  bound: boolean;
  online: boolean;
  offlineUntil: number | null;
  gcodeState: BambuGcodeState;
  startedAt: number;
  durationMs: number;
  armed: SimOutcome;
  mcPercent: number;
  mcRemaining: number;
  gcodeFile: string;
  subtaskName: string;
  taskId: string;
  hms: BambuHms[];
}

const store = new Map<string, MockPrinter>();

function ensure(sn: string, model = 'mock'): MockPrinter {
  let p = store.get(sn);
  if (!p) {
    p = {
      sn, model, name: sn, ip: '192.0.2.1',
      bound: false, online: false, offlineUntil: null,
      gcodeState: 'IDLE', startedAt: 0, durationMs: printMs(), armed: 'success',
      mcPercent: 0, mcRemaining: 0, gcodeFile: '', subtaskName: '', taskId: '', hms: [],
    };
    store.set(sn, p);
  }
  return p;
}

/** Lazy ticker — advance the print state machine from elapsed wall-clock. */
function advance(p: MockPrinter, now: number): void {
  if (p.offlineUntil != null && now >= p.offlineUntil) {
    p.online = true;
    p.offlineUntil = null;
  }
  if (!p.online) return; // offline printers freeze — and never fire an event
  if (p.gcodeState !== 'PREPARE' && p.gcodeState !== 'RUNNING') return;

  const elapsed = now - p.startedAt;
  if (elapsed < prepareMs()) {
    p.gcodeState = 'PREPARE';
  } else if (elapsed < prepareMs() + p.durationMs) {
    p.gcodeState = 'RUNNING';
    p.mcPercent = Math.min(100, Math.floor((100 * (elapsed - prepareMs())) / p.durationMs));
    p.mcRemaining = Math.max(0, Math.ceil((prepareMs() + p.durationMs - elapsed) / 1000));
  } else if (p.armed === 'failed') {
    p.gcodeState = 'FAILED';
    p.hms = [{ ...FAULT_HMS, timestamp: Math.floor(now / 1000) }];
  } else if (p.armed === 'filament_runout') {
    p.gcodeState = 'PAUSE';
    p.hms = [{ ...FILAMENT_HMS, action: 0, timestamp: Math.floor(now / 1000) }];
  } else {
    p.gcodeState = 'FINISH';
    p.mcPercent = 100;
  }
}

function snapshot(p: MockPrinter): BambuPollResult {
  return {
    ok: true,
    snapshot: {
      sn: p.sn, model: p.model, name: p.name, ip: p.ip,
      online: p.online, bound: p.bound,
      reportStatus: {
        gcode_state: p.gcodeState,
        mc_percent: p.mcPercent,
        mc_remaining_time: p.mcRemaining,
        layer_num: 0,
        total_layer_num: 0,
        gcode_file: p.gcodeFile,
        subtask_name: p.subtaskName,
        task_id: p.taskId,
        hms: p.hms,
      },
    },
  };
}

/** The client surface the batch executor calls (mock implementation). */
export const mockBackend = {
  async bind(sn: string, model = 'mock'): Promise<void> {
    const p = ensure(sn, model);
    p.bound = true;
    p.online = true;
  },
  async unbind(sn: string): Promise<void> {
    const p = store.get(sn);
    if (p) { p.bound = false; p.online = false; p.gcodeState = 'IDLE'; p.hms = []; }
  },
  async pollDevice(sn: string): Promise<BambuPollResult> {
    const p = store.get(sn);
    if (!p || !p.bound) return { ok: false, error: 'unbound' };
    advance(p, Date.now());
    return snapshot(p);
  },
  async opt(sn: string, opt: 'pause' | 'resume' | 'stop' | 'bed_clean'): Promise<void> {
    const p = store.get(sn);
    if (!p || !p.bound) return;
    advance(p, Date.now());
    const s = p.gcodeState;
    if (opt === 'pause' && s === 'RUNNING') p.gcodeState = 'PAUSE';
    else if (opt === 'resume' && s === 'PAUSE') {
      // filament reloaded → the resumed run completes successfully
      p.armed = 'success';
      p.gcodeState = 'RUNNING';
      p.hms = [];
      p.startedAt = Date.now() - prepareMs();
    } else if (opt === 'stop' && (s === 'RUNNING' || s === 'PAUSE' || s === 'PREPARE')) {
      p.gcodeState = 'FAILED';
      p.mcRemaining = 0;
    } else if (opt === 'bed_clean' && (s === 'FINISH' || s === 'FAILED')) {
      p.gcodeState = 'IDLE';
      p.mcPercent = 0;
      p.gcodeFile = '';
      p.subtaskName = '';
      p.hms = [];
    }
  },
  async uploadAndPrint(sn: string, job: { jobId: string; simOutcome?: SimOutcome }): Promise<void> {
    const p = store.get(sn);
    if (!p || !p.bound || !p.online) return;
    advance(p, Date.now());
    if (p.gcodeState !== 'IDLE') return; // device busy — real API returns code 1051
    p.gcodeState = 'PREPARE';
    p.startedAt = Date.now();
    p.durationMs = printMs();
    p.armed = job.simOutcome ?? 'success';
    p.mcPercent = 0;
    p.hms = [];
    p.gcodeFile = 'Metadata/plate_1.gcode';
    p.subtaskName = job.jobId;
    p.taskId = job.jobId;
  },
};

/** Test-only control surface (in-process). The driver uses job `simOutcome` instead. */
export const mockControl = {
  arm(sn: string, outcome: SimOutcome): void { ensure(sn).armed = outcome; },
  setOnline(sn: string, online: boolean): void {
    const p = ensure(sn);
    p.online = online;
    p.offlineUntil = null;
  },
  powerCycle(sn: string, offlineMs: number): void {
    const p = ensure(sn);
    p.online = false;
    p.offlineUntil = Date.now() + offlineMs;
  },
  reset(): void { store.clear(); },
  peek(sn: string): MockPrinter | undefined { return store.get(sn); },
};
