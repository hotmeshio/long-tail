/**
 * Universal IAM service for Long Tail.
 *
 * Provides identity context propagation, resolution, and credential lookup
 * that works identically across all invocation paths:
 * - MCP server tools
 * - Proxy activities in workflows
 * - YAML workflow workers
 * - Direct route handlers
 */
export { runWithToolContext, getToolContext } from './context';
export { resolveToolContext } from './resolve';
export type { ToolContextSource } from './resolve';
export { resolveCredential, MissingCredentialError } from './credentials';
export type { ResolvedCredential } from './credentials';
export {
  createBot,
  getBot,
  listBots,
  updateBot,
  deactivateBot,
  deleteBot,
  createBotKey,
  listBotKeys,
  revokeBotKey,
  addBotRole,
  removeBotRole,
  getBotRoles,
  ensureSystemBot,
} from './bots';
export type { CreateBotInput, BotAccountRecord, BotApiKeyRecord } from './bots';
