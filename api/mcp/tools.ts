import { mcpRegistry } from '../../services/mcp';
import * as mcpClient from '../../services/mcp/client';
import * as userService from '../../services/user';
import { capabilityAccess } from '../../modules/capabilities';
import { assertMayActAs, InvocationError } from '../../services/workflow-invocation';
import { builtinMcpServerFactories } from '../../system';
import { isUuid } from '../../lib/uuid';
import type { CapabilityGate } from '../../types';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

const ROLE_TYPE_ORDER = ['superadmin', 'admin', 'member'] as const;

const normalizeName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

/**
 * The built-in server a server id or name refers to: the one a tool call would
 * dispatch to, else a shipped factory whose name matches. Null for an external
 * server. Matching both keeps the gate in force wherever the code runs.
 */
export async function builtinServerFor(serverIdOrName: string): Promise<string | null> {
  const registered = await mcpClient.resolveBuiltinServerName(serverIdOrName);
  if (registered) return registered;
  if (builtinMcpServerFactories[serverIdOrName]) return serverIdOrName;
  const wanted = normalizeName(serverIdOrName);
  if (!wanted) return null;
  return Object.keys(builtinMcpServerFactories).find((name) => {
    const have = normalizeName(name);
    return have.includes(wanted) || wanted.includes(have);
  }) ?? null;
}

/**
 * The capability a built-in tool's manifest gates it at, from the manifest the
 * server was registered with (Long Tail's or the host's). A tool without a gate needs builder.
 */
export function builtinToolGate(serverName: string, toolName: string): CapabilityGate {
  const manifest = mcpClient.getBuiltinToolManifest(serverName)
    ?? builtinMcpServerFactories[serverName]?.config?.toolManifest;
  return manifest?.find((t) => t.name === toolName)?.gate ?? 'builder';
}

/** The principal a tool call acts as: the caller, or an execute_as target the caller outranks. */
async function actingPrincipal(
  auth: LTApiAuth,
  executeAs: string | undefined,
): Promise<{ userId: string; role?: string }> {
  if (!executeAs) return { userId: auth.userId, role: auth.role };
  await assertMayActAs(auth.userId, executeAs);
  const target = isUuid(executeAs)
    ? await userService.getUser(executeAs)
    : await userService.getUserByExternalId(executeAs);
  if (!target) throw new InvocationError(`execute_as principal "${executeAs}" not found`, 404);
  const role = ROLE_TYPE_ORDER.find((type) => target.roles.some((r) => r.type === type));
  return { userId: target.id, role };
}

/**
 * List all tools exposed by a connected MCP server.
 *
 * Requires the MCP adapter to be registered and the server to be connected.
 *
 * @param input.id — the MCP server identifier
 * @returns `{ status: 200, data: { tools } }` array of tool descriptors
 */
export async function listMcpServerTools(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      return { status: 400, error: 'MCP adapter not registered' };
    }
    const tools = await adapter.listTools(input.id);
    return { status: 200, data: { tools } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Invoke a specific tool on a connected MCP server.
 *
 * Passes the tool arguments and an optional auth context (derived from
 * `execute_as` or the authenticated user) to the MCP adapter. Returns
 * 422 with `missing_credential` if the tool requires a credential the
 * user has not registered.
 *
 * @param input.id — the MCP server identifier
 * @param input.toolName — name of the tool to invoke
 * @param input.arguments — key-value arguments to pass to the tool
 * @param input.execute_as — optional user ID to impersonate for the tool call
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { result } }` the tool execution result
 */
export async function callMcpTool(
  input: {
    id: string;
    toolName: string;
    arguments?: Record<string, any>;
    execute_as?: string;
  },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!auth?.userId) return { status: 401, error: 'Authentication required' };
    const actor = await actingPrincipal(auth, input.execute_as);
    // Inject user_id into arguments so builtin tools can resolve
    // the calling user's credentials (OAuth tokens, etc.)
    const args = { ...(input.arguments || {}) };
    if (!args.user_id) args.user_id = actor.userId;

    // A built-in tool runs in this process. It is gated as /mcp gates it, by
    // the tool's manifest capability for the acting principal (live, never a
    // role claim), and runs as that principal rather than as lt-system.
    const builtin = await builtinServerFor(input.id);
    if (builtin) {
      const permitted = await capabilityAccess({ userId: actor.userId })(builtinToolGate(builtin, input.toolName));
      if (!permitted) return { status: 403, error: `Forbidden: ${input.toolName} is not available to you` };
      const result = await mcpClient.callBuiltinToolAs(builtin, input.toolName, args, actor);
      return { status: 200, data: { result } };
    }

    // An external server's tools run on its stored credential (headers, env),
    // which carries that server's authority: a builder's to use.
    if (!(await capabilityAccess({ userId: actor.userId })('builder'))) {
      return { status: 403, error: `Forbidden: tools on an external MCP server need builder access` };
    }
    const adapter = mcpRegistry.current;
    if (!adapter) {
      return { status: 400, error: 'MCP adapter not registered' };
    }
    const result = await adapter.callTool(
      input.id,
      input.toolName,
      args,
      { userId: actor.userId },
    );
    return { status: 200, data: { result } };
  } catch (err: any) {
    if (err instanceof InvocationError) return { status: err.statusCode, error: err.message };
    if (err.name === 'ToolNotFoundError') return { status: 404, error: err.message };
    if (err.name === 'MissingCredentialError') {
      return {
        status: 422,
        error: 'missing_credential',
        ...({ provider: err.provider, message: err.message } as any),
      };
    }
    return { status: 500, error: err.message };
  }
}
