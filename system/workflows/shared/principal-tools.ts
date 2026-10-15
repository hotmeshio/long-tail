import { getToolContext } from '../../../services/iam/context';
import * as userService from '../../../services/user';
import { capabilityAccess } from '../../../modules/capabilities';
import { builtinServerFor, builtinToolGate } from '../../../api/mcp/tools';
import { isUuid } from '../../../lib/uuid';
import type { CapabilityAccess } from '../../../types';

/**
 * Tools an LLM chooses act with the authority of the person (or bot) the
 * workflow runs as, never lt-system's: the same manifest gate /mcp applies,
 * and the handler sees that principal as its caller. A workflow running
 * with no principal (an internal job) keeps lt-system, as before.
 */
export interface ToolPrincipal {
  userId: string;
  access: CapabilityAccess;
}

/** The principal the current tool context runs as, resolved to its account; null for none. */
export async function currentToolPrincipal(): Promise<ToolPrincipal | null> {
  const id = getToolContext()?.principal.id;
  if (!id) return null;
  const user = isUuid(id) ? await userService.getUser(id) : await userService.getUserByExternalId(id);
  if (!user) return null;
  return { userId: user.id, access: capabilityAccess({ userId: user.id }) };
}

/**
 * The built-in server a tool belongs to when the principal may call it; null
 * for an external server the principal may call; undefined when refused. An
 * external server's tools run on its stored credential (a remote Long Tail's
 * service-account key, say), so they are a builder's to call.
 */
export async function permittedBuiltin(
  principal: ToolPrincipal,
  serverName: string,
  toolName: string,
): Promise<string | null | undefined> {
  const builtin = await builtinServerFor(serverName);
  if (!builtin) return (await principal.access('builder')) ? null : undefined;
  return (await principal.access(builtinToolGate(builtin, toolName))) ? builtin : undefined;
}
