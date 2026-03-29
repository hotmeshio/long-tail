import { execFile } from 'child_process';
import { promisify } from 'util';

import { loggerRegistry } from '../../services/logger';

const execFileAsync = promisify(execFile);

/** Maximum execution time for a Claude Code task (5 minutes) */
const MAX_TIMEOUT_MS = 300_000;

/** Default execution time (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolved credential with its type so the correct env var is set. */
interface ResolvedCredential {
  value: string;
  type: 'oauth_token' | 'api_key';
}

/**
 * Resolve the Anthropic credential for a given request.
 *
 * Returns a credential object or `null`. When `null`, the subprocess will
 * fall back to Claude Code's own credential resolution (e.g., an OAuth
 * session stored in the OS keychain from a prior `claude auth login`).
 *
 * Priority:
 *   1. Explicit `api_key` in args (for testing / direct calls)
 *   2. User's stored credential (from "Connect Anthropic" flow)
 *   3. System-level CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY env var
 *   4. null — let the CLI resolve credentials itself (local dev)
 */
async function resolveCredential(args: {
  api_key?: string;
  credential_label?: string;
  _auth?: { userId?: string; token?: string };
}): Promise<ResolvedCredential | null> {
  if (args.api_key) {
    return {
      value: args.api_key,
      type: args.api_key.startsWith('sk-ant-oat') ? 'oauth_token' : 'api_key',
    };
  }

  // Fetch the user's stored Anthropic credential (optionally by label)
  if (args._auth?.userId) {
    try {
      const { getFreshAccessToken } = await import('../../services/oauth');
      const token = await getFreshAccessToken(args._auth.userId, 'anthropic', args.credential_label);
      if (token?.accessToken) {
        const isOAuth = token.accessToken.startsWith('sk-ant-oat');
        loggerRegistry.info(
          `[lt-activity:claude-code] using stored Anthropic ${isOAuth ? 'OAuth token' : 'API key'}` +
          ` (label: ${token.label}) for user`,
        );
        return { value: token.accessToken, type: isOAuth ? 'oauth_token' : 'api_key' };
      }
    } catch {
      // No stored Anthropic connection for this user — fall through
    }
  }

  // System-level env vars
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { value: process.env.CLAUDE_CODE_OAUTH_TOKEN, type: 'oauth_token' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { value: process.env.ANTHROPIC_API_KEY, type: 'api_key' };
  }

  return null;
}

/**
 * Build the `claude` CLI command arguments for a prompt execution.
 */
function buildClaudeArgs(args: {
  prompt: string;
  working_directory?: string;
  allowed_tools?: string[];
  max_turns?: number;
  model?: string;
  system_prompt?: string;
}): string[] {
  const cliArgs = ['-p', args.prompt, '--output-format', 'json'];

  if (args.max_turns) {
    cliArgs.push('--max-turns', String(args.max_turns));
  }

  if (args.model) {
    cliArgs.push('--model', args.model);
  }

  if (args.system_prompt) {
    cliArgs.push('--append-system-prompt', args.system_prompt);
  }

  if (args.allowed_tools?.length) {
    for (const tool of args.allowed_tools) {
      cliArgs.push('--allowedTools', tool);
    }
  }

  return cliArgs;
}

// ── Activities ───────────────────────────────────────────────────────────────

/**
 * Execute a task using Claude Code CLI.
 *
 * Spawns `claude -p "<prompt>"` as a subprocess with a scoped environment.
 * The API key is resolved from the auth context (delegation) or system env.
 * Output is returned as structured JSON when possible.
 *
 * Authentication by proxy:
 *   When called from a workflow with `_auth.userId`, the delegation token
 *   identifies which user initiated the request. The activity uses this to:
 *   - Log the requesting user for audit
 *   - Scope the working directory (future: per-user sandboxing)
 *   - Resolve the correct API key
 */
export async function executeTask(args: {
  prompt: string;
  working_directory?: string;
  allowed_tools?: string[];
  max_turns?: number;
  model?: string;
  system_prompt?: string;
  timeout_ms?: number;
  api_key?: string;
  credential_label?: string;
  _auth?: { userId?: string; token?: string };
}): Promise<{
  result: string;
  session_id?: string;
  cost_usd?: number;
  duration_ms: number;
  is_error: boolean;
  user_id?: string;
}> {
  const start = Date.now();
  const userId = args._auth?.userId;

  loggerRegistry.info(
    `[lt-activity:claude-code] execute_task` +
    (userId ? ` (user: ${userId})` : '') +
    `: "${args.prompt.slice(0, 80)}${args.prompt.length > 80 ? '...' : ''}"`,
  );

  const credential = await resolveCredential(args);
  const cliArgs = buildClaudeArgs(args);
  const timeout = Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  // Build subprocess environment.
  //
  // Three modes:
  //   1. OAuth token (sk-ant-oat...) — set CLAUDE_CODE_OAUTH_TOKEN
  //      Uses the user's Claude subscription at flat rate.
  //   2. API key (sk-ant-api...) — set ANTHROPIC_API_KEY
  //      Billed per-token against their API account.
  //   3. No credential — inherit parent env so the CLI can find its
  //      own OAuth session in the OS keychain (local dev).
  //
  // In all cases CI=true disables interactive prompts.
  let env: Record<string, string>;
  if (credential) {
    env = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/root',
      CI: 'true',
    };
    if (credential.type === 'oauth_token') {
      env.CLAUDE_CODE_OAUTH_TOKEN = credential.value;
    } else {
      env.ANTHROPIC_API_KEY = credential.value;
    }
  } else {
    env = { ...process.env as Record<string, string>, CI: 'true' };
  }

  try {
    const { stdout, stderr } = await execFileAsync('claude', cliArgs, {
      cwd: args.working_directory || process.cwd(),
      env,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const duration_ms = Date.now() - start;

    // Try to parse structured JSON output
    let result: string;
    let session_id: string | undefined;
    let cost_usd: number | undefined;

    try {
      const parsed = JSON.parse(stdout);
      result = parsed.result ?? parsed.text ?? stdout;
      session_id = parsed.session_id;
      cost_usd = parsed.cost_usd;
    } catch {
      result = stdout;
    }

    if (stderr) {
      loggerRegistry.warn(`[lt-activity:claude-code] stderr: ${stderr.slice(0, 200)}`);
    }

    loggerRegistry.info(
      `[lt-activity:claude-code] completed in ${duration_ms}ms` +
      (cost_usd ? ` ($${cost_usd.toFixed(4)})` : ''),
    );

    return { result, session_id, cost_usd, duration_ms, is_error: false, user_id: userId };
  } catch (err: any) {
    const duration_ms = Date.now() - start;

    // execFile throws on non-zero exit or timeout
    const isTimeout = err.killed || err.code === 'ETIMEDOUT';
    const message = isTimeout
      ? `Claude Code timed out after ${timeout}ms`
      : err.stderr || err.message;

    loggerRegistry.error(`[lt-activity:claude-code] failed: ${message}`);

    return {
      result: message,
      duration_ms,
      is_error: true,
      user_id: userId,
    };
  }
}

/**
 * Check whether Claude Code CLI is installed and an API key is available.
 *
 * Returns availability status and version. Useful for workflows that need
 * to decide whether to route to Claude Code or fall back to another tool.
 */
export async function checkAvailability(args: {
  _auth?: { userId?: string; token?: string };
} = {}): Promise<{
  available: boolean;
  version?: string;
  has_api_key: boolean;
  has_oauth_session: boolean;
  auth_method?: string;
  user_id?: string;
  error?: string;
}> {
  const userId = args._auth?.userId;

  const credential = await resolveCredential(args);
  const has_api_key = !!credential;

  // Check CLI availability and auth status
  try {
    const { stdout: versionOut } = await execFileAsync('claude', ['--version'], {
      timeout: 5_000,
      env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' },
    });
    const version = versionOut.trim();

    // Check if CLI has a valid auth session (OAuth or API key)
    let auth_method: string | undefined;
    let has_oauth_session = false;
    try {
      const { stdout: statusOut } = await execFileAsync('claude', ['auth', 'status'], {
        timeout: 5_000,
        env: { ...process.env as Record<string, string> },
      });
      const status = JSON.parse(statusOut);
      has_oauth_session = status.loggedIn === true;
      auth_method = status.authMethod;
    } catch {
      // auth status failed — no OAuth session
    }

    return {
      available: true,
      version,
      has_api_key,
      has_oauth_session,
      auth_method,
      user_id: userId,
    };
  } catch (err: any) {
    return {
      available: false,
      has_api_key,
      has_oauth_session: false,
      user_id: userId,
      error: `Claude Code CLI not found: ${err.message}`,
    };
  }
}
