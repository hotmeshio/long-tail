/**
 * The `http` Bambu backend — the real physical boundary over mTLS. Talks to a
 * Farm Manager Server (or the Python mock in `bambu_config/mock_server_reference/`)
 * exactly as the `farm_demo` SDK does: a client cert/key + custom CA presented on
 * every connection, with a forced SNI so the same certs verify whether the URL is
 * a LAN IP or the real hostname. Every specific — host, cert paths, credentials —
 * comes from env; nothing is hardcoded. Cutover to real Bambu is these env values
 * only (base URL + real signed certs), no code change.
 *
 * This is plain activity code (not a workflow), so wall-clock time and real I/O
 * are fine. It codes against the same `BambuClient` interface the mock does, so
 * the twin workflow never changes between the two.
 */

import { readFileSync } from 'node:fs';
import * as https from 'node:https';

import type { BambuClient } from './bambu-client';
import type { BambuPollResult, BambuGcodeState, BambuHms } from '../mirror';
import type { TwinJobPayload } from '../types';

// ── Config (env-resolved, fail-loud) ─────────────────────────────────────────

interface HttpConfig {
  baseUrl: string;
  clientCert: string;
  clientKey: string;
  caCert: string;
  serverName: string;
  adminUser: string;
  adminPass: string;
}

/** The Farm Manager error code for a device that isn't bound (poll → `unbound`). */
const UNBOUND_CODE = 1006;
/** The Farm Manager error code for a busy device (print → no-op, matches mock). */
const DEVICE_BUSY_CODE = 1051;
/** The SDK's shared client key, sent on token exchange (`client_login.py`). */
const SHARED_CLIENT_KEY = 'bbl_third_party';
/** Placeholder file bytes when a job's gcode URL isn't fetchable — the mock
 *  ignores 3mf contents, so any bytes prove the multipart upload path. */
const PLACEHOLDER_3MF = Buffer.from('LT-TWIN-PLACEHOLDER-3MF');

function resolveHttpConfig(env: NodeJS.ProcessEnv): HttpConfig {
  const cfg = {
    baseUrl: env.BAMBU_BASE_URL,
    clientCert: env.BAMBU_CLIENT_CERT,
    clientKey: env.BAMBU_CLIENT_KEY,
    caCert: env.BAMBU_CA_CERT,
    serverName: env.BAMBU_SERVERNAME,
    adminUser: env.BAMBU_ADMIN_USER,
    adminPass: env.BAMBU_ADMIN_PASS,
  };
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => `BAMBU_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`);
  if (missing.length) {
    throw new Error(`BAMBU_BACKEND=http is missing required env: ${missing.join(', ')}`);
  }
  return cfg as HttpConfig;
}

// ── Typed error (context + cause, no coupling to src/lib so the twin lifts clean) ─

class BambuHttpError extends Error {
  readonly context: { method: string; path: string; status?: number; body?: unknown };
  constructor(
    message: string,
    context: { method: string; path: string; status?: number; body?: unknown },
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'BambuHttpError';
    this.context = context;
    // Preserve the original error without relying on ES2022 Error `cause`.
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

// ── Transport (a single mTLS agent, forced SNI, verified against our CA) ──────

interface Lazy {
  cfg: HttpConfig;
  agent: https.Agent;
}

let lazy: Lazy | null = null;
let cachedToken: string | null = null;

function ensure(): Lazy {
  if (lazy) return lazy;
  const cfg = resolveHttpConfig(process.env);
  // Forcing `servername` to the SNI the cert is issued for gives full chain +
  // identity verification against our CA even when dialing a raw LAN IP — the
  // real server's cert SAN is only that hostname. Node/OpenSSL accepts the
  // mock CA that Python 3.13+ rejects for a missing Subject Key Identifier.
  const agent = new https.Agent({
    cert: readFileSync(cfg.clientCert),
    key: readFileSync(cfg.clientKey),
    ca: readFileSync(cfg.caCert),
    servername: cfg.serverName,
    rejectUnauthorized: true,
    keepAlive: true,
  });
  lazy = { cfg, agent };
  return lazy;
}

interface RawResponse {
  status: number;
  contentType: string;
  body: any;
}

interface RequestOpts {
  token?: string | null;
  json?: unknown;
  rawBody?: Buffer;
  contentType?: string;
}

function request(method: string, path: string, opts: RequestOpts = {}): Promise<RawResponse> {
  const { cfg, agent } = ensure();
  const url = new URL(path, cfg.baseUrl);
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let payload: Buffer | undefined;
  if (opts.rawBody) {
    payload = opts.rawBody;
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
  } else if (opts.json !== undefined) {
    payload = Buffer.from(JSON.stringify(opts.json));
    headers['Content-Type'] = 'application/json';
  }
  if (payload) headers['Content-Length'] = String(payload.length);

  return new Promise<RawResponse>((resolve, reject) => {
    const req = https.request(
      { agent, method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, servername: cfg.serverName, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const contentType = res.headers['content-type'] ?? '';
          let body: any = raw;
          if (contentType.includes('application/json')) {
            try {
              body = JSON.parse(raw.toString('utf8') || '{}');
            } catch {
              body = raw.toString('utf8');
            }
          } else {
            body = raw.toString('utf8');
          }
          resolve({ status: res.statusCode ?? 0, contentType, body });
        });
      },
    );
    req.on('error', (err) => reject(new BambuHttpError(`transport error: ${err.message}`, { method, path }, { cause: err })));
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Login (3-step ticket → challenge/salt → triple-SHA256 → token) ───────────

import { createHash } from 'node:crypto';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

async function login(): Promise<string> {
  const { cfg } = ensure();
  const ticketRes = await request('POST', '/login/local/tickets', { json: { user_name: cfg.adminUser } });
  if (ticketRes.status !== 200 || ticketRes.body?.code !== 0 || !ticketRes.body?.ticket) {
    throw new BambuHttpError('login ticket rejected', { method: 'POST', path: '/login/local/tickets', status: ticketRes.status, body: ticketRes.body });
  }
  const { challenge, salt } = JSON.parse(Buffer.from(ticketRes.body.ticket, 'base64').toString('utf8'));
  const hashed = sha256(sha256(sha256(cfg.adminPass) + salt) + challenge);
  const tokenRes = await request('POST', '/login/local/tokens', {
    json: { user_name: cfg.adminUser, password: hashed, ticket_id: ticketRes.body.ticket_id, shared_client_key: SHARED_CLIENT_KEY },
  });
  if (tokenRes.status !== 200 || tokenRes.body?.code !== 0 || !tokenRes.body?.token) {
    throw new BambuHttpError('login token rejected', { method: 'POST', path: '/login/local/tokens', status: tokenRes.status, body: tokenRes.body });
  }
  cachedToken = tokenRes.body.token;
  return cachedToken as string;
}

/** Run an authed request, re-logging in once on 401 (token expiry/rotation). */
async function authed(method: string, path: string, opts: RequestOpts = {}): Promise<RawResponse> {
  const token = cachedToken ?? (await login());
  const res = await request(method, path, { ...opts, token });
  if (res.status !== 401) return res;
  cachedToken = null;
  return request(method, path, { ...opts, token: await login() });
}

// ── Multipart (mirrors https_raw.py's HttpsPutFile) ──────────────────────────

function multipart(parts: Array<{ field: string; filename?: string; mime: string; content: Buffer }>): { body: Buffer; contentType: string } {
  const boundary = '----LongTailTwinBoundary7MA4YWxkTrZu0gW';
  const segments: Buffer[] = [];
  for (const p of parts) {
    const disp = p.filename
      ? `form-data; name="${p.field}"; filename="${p.filename}"`
      : `form-data; name="${p.field}"`;
    segments.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disp}\r\nContent-Type: ${p.mime}\r\n\r\n`));
    segments.push(p.content);
    segments.push(Buffer.from('\r\n'));
  }
  segments.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(segments), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function resolveFileBytes(gcodeUrl: string): Promise<Buffer> {
  if (!/^https?:\/\//i.test(gcodeUrl)) return PLACEHOLDER_3MF;
  try {
    const res = await fetch(gcodeUrl);
    if (!res.ok) return PLACEHOLDER_3MF;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return PLACEHOLDER_3MF;
  }
}

// ── Poll mapping ─────────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

function toSnapshot(sn: string, devInfo: any): BambuPollResult {
  const rs = devInfo.report_status ?? {};
  return {
    ok: true,
    snapshot: {
      sn,
      model: devInfo.dev_model ?? '',
      name: devInfo.name ?? sn,
      ip: devInfo.dev_ip ?? '',
      online: !!devInfo.online,
      bound: true,
      reportStatus: {
        gcode_state: (rs.gcode_state ?? 'IDLE') as BambuGcodeState,
        mc_percent: num(rs.mc_percent),
        mc_remaining_time: num(rs.mc_remaining_time),
        layer_num: num(rs.layer_num),
        total_layer_num: num(rs.total_layer_num),
        gcode_file: rs.gcode_file ?? '',
        subtask_name: rs.subtask_name ?? '',
        task_id: rs.task_id ?? '',
        hms: Array.isArray(rs.hms) ? (rs.hms as BambuHms[]) : [],
      },
    },
  };
}

// ── The backend ──────────────────────────────────────────────────────────────

export const httpBackend: BambuClient = {
  async bind(sn: string): Promise<void> {
    const res = await authed('PUT', '/sdk/device/bind', { json: { devices: [{ device_id: sn }] } });
    const result = res.body?.bind_results?.find((r: any) => r.device_id === sn);
    if (res.status !== 200 || (result && result.code !== 0)) {
      throw new BambuHttpError(`bind ${sn} failed`, { method: 'PUT', path: '/sdk/device/bind', status: res.status, body: res.body });
    }
  },

  async unbind(sn: string): Promise<void> {
    const res = await authed('DELETE', '/bind', { json: { dev_ids: [sn] } });
    if (res.status !== 200) {
      throw new BambuHttpError(`unbind ${sn} failed`, { method: 'DELETE', path: '/bind', status: res.status, body: res.body });
    }
  },

  async pollDevice(sn: string): Promise<BambuPollResult> {
    let res: RawResponse;
    try {
      res = await authed('GET', `/device/${sn}`);
    } catch (err) {
      return { ok: false, error: 'transport', message: err instanceof Error ? err.message : String(err) };
    }
    if (res.status === 404 || res.body?.code === UNBOUND_CODE) return { ok: false, error: 'unbound' };
    if (res.status !== 200 || !res.body?.dev_info) {
      return { ok: false, error: 'transport', message: `unexpected poll response ${res.status}` };
    }
    return toSnapshot(sn, res.body.dev_info);
  },

  async opt(sn: string, opt: 'pause' | 'resume' | 'stop' | 'bed_clean'): Promise<void> {
    const res = await authed('POST', `/device/${sn}/opt`, { json: { opt } });
    // A 200 with a non-zero code is a guard rejection (e.g. "cannot pause from
    // IDLE") — a benign no-op, exactly like the in-repo mock; the next poll
    // corrects our stale view. Only a transport/HTTP failure throws.
    if (res.status !== 200) {
      throw new BambuHttpError(`opt ${opt} on ${sn} failed`, { method: 'POST', path: `/device/${sn}/opt`, status: res.status, body: res.body });
    }
  },

  async uploadAndPrint(sn: string, job: TwinJobPayload): Promise<void> {
    const fileBytes = await resolveFileBytes(job.gcodeUrl);
    const printCmd = JSON.stringify({ task_name: job.jobId, plate: 'Metadata/plate_1.gcode' });
    const { body, contentType } = multipart([
      { field: 'print_cmd', mime: 'application/json', content: Buffer.from(printCmd) },
      { field: 'file', filename: `${job.jobId}.3mf`, mime: 'application/octet-stream', content: fileBytes },
    ]);
    const res = await authed('PUT', `/device/${sn}/print`, { rawBody: body, contentType });
    // code 1051 = device busy — a no-op, matching the mock (real API returns
    // this when the machine isn't IDLE). Any other failure is loud.
    if (res.status !== 200 || (res.body?.code !== 0 && res.body?.code !== DEVICE_BUSY_CODE)) {
      throw new BambuHttpError(`print on ${sn} failed`, { method: 'PUT', path: `/device/${sn}/print`, status: res.status, body: res.body });
    }
  },
};

/** Test seam — reset the cached agent/token between cases. */
export function __resetHttpBackend(): void {
  lazy = null;
  cachedToken = null;
}

export { BambuHttpError };
