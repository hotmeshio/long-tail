import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import pc from 'picocolors';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'longtail');
const CREDS_FILE = path.join(CONFIG_DIR, 'credentials.json');

export interface StoredCredentials {
  server: string;
  token: string;
  username: string;
  password: string;
  expiresAt: string;
}

export interface AuthContext {
  server: string;
  token: string;
}

/** Resolve auth from env → stored credentials → error */
export async function resolveAuth(): Promise<AuthContext> {
  // 1. Environment variables (CI / scripts)
  if (process.env.LT_TOKEN && process.env.LT_SERVER) {
    return { server: process.env.LT_SERVER, token: process.env.LT_TOKEN };
  }

  // 2. Stored credentials
  const creds = loadCredentials();
  if (!creds) {
    throw new Error('Not logged in. Run: ltc login');
  }

  // 3. Check expiry, auto-refresh if needed
  if (isExpired(creds.token)) {
    const fresh = await loginRequest(creds.server, creds.username, creds.password);
    saveCredentials({ ...creds, token: fresh.token, expiresAt: fresh.expiresAt });
    return { server: creds.server, token: fresh.token };
  }

  return { server: creds.server, token: creds.token };
}

/** Interactive or flag-based login */
export async function login(options: {
  server?: string;
  username?: string;
  password?: string;
}): Promise<void> {
  let { server, username, password } = options;

  // Interactive prompts for missing values
  if (!server) {
    server = await prompt('Server URL', 'http://localhost:3000');
  }
  if (!username) {
    username = await prompt('Username');
  }
  if (!password) {
    password = await prompt('Password');
  }

  server = server!.replace(/\/+$/, '');

  const result = await loginRequest(server, username!, password!);
  saveCredentials({
    server,
    token: result.token,
    username: username!,
    password: password!,
    expiresAt: result.expiresAt,
  });

  console.log(`\n  ${pc.green('✓')} Logged in as ${pc.bold(result.displayName || username)} at ${pc.dim(server)}`);
  console.log(pc.dim(`    Token expires: ${result.expiresAt}\n`));
}

/** Clear stored credentials */
export function logout(): void {
  if (fs.existsSync(CREDS_FILE)) {
    fs.unlinkSync(CREDS_FILE);
    console.log(`\n  ${pc.green('✓')} Logged out. Credentials cleared.\n`);
  } else {
    console.log(pc.dim('\n  No stored credentials found.\n'));
  }
}

/** Get the current server URL (for display purposes) */
export function getServerUrl(): string | null {
  if (process.env.LT_SERVER) return process.env.LT_SERVER;
  const creds = loadCredentials();
  return creds?.server || null;
}

// ── Internal ─────────────────────────────────────────────────────────────

async function loginRequest(
  server: string,
  username: string,
  password: string,
): Promise<{ token: string; expiresAt: string; displayName?: string }> {
  const res = await fetch(`${server}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Login failed (HTTP ${res.status})`);
  }

  const data = await res.json() as any;
  const token = data.token as string;

  // Decode JWT to get expiry
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  const expiresAt = new Date(payload.exp * 1000).toISOString();

  return {
    token,
    expiresAt,
    displayName: data.user?.display_name || data.user?.external_id,
  };
}

function loadCredentials(): StoredCredentials | null {
  try {
    if (!fs.existsSync(CREDS_FILE)) return null;
    return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCredentials(creds: StoredCredentials): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return Date.now() >= payload.exp * 1000 - 60_000; // 1min buffer
  } catch {
    return true;
  }
}

async function prompt(label: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? pc.dim(` (${defaultValue})`) : '';
  process.stdout.write(`  ${label}${suffix}: `);
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (chunk) => {
      data = chunk.toString().trim();
      resolve(data || defaultValue || '');
    });
    process.stdin.resume();
  });
}
