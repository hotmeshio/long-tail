/**
 * Sanitize a value for use as an MCP tool name or HotMesh graph topic
 * (the `subscribes` field in a YAML DAG).
 *
 * ## Why snake_case
 *
 * MCP tool names become the `subscribes` topic in a HotMesh YAML DAG.
 * That topic is how the system routes incoming messages to the correct
 * workflow. The same value also appears in `worker` activity `topic`
 * fields and in the `mcp_<server>_<tool>` activity type encoding.
 *
 * Because the activity type uses underscores to delimit server from tool
 * (`mcp_longtail_take_screenshot`), both the server name (letters only)
 * and the tool name (snake_case) must avoid dashes, dots, or other
 * separators that would create ambiguity when parsing activity types.
 *
 * ## Risks if violated
 *
 * - Dashes in tool names cause `parseMcpActivityType()` to mis-split
 *   the server/tool boundary in activity type strings.
 * - Dots or special chars can produce invalid HotMesh topic subscriptions
 *   that silently fail to route.
 * - Mixed conventions across entry points (builder, planner, discovery)
 *   cause topic collisions or deployment failures when merging workflows
 *   into a single app namespace.
 *
 * ## Contract
 *
 * Input:  any string (LLM output, user input, URL slug, etc.)
 * Output: lowercase letters, digits, and underscores only.
 *         Runs of non-alphanumeric chars become a single underscore.
 *         No leading or trailing underscores.
 *
 * This is the ONE canonical frontend implementation. The backend has an
 * identical copy at `modules/utils.ts`. No other file in the platform
 * may inline this logic.
 */
export function sanitizeToolName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Sanitize a value for use as an MCP server name (the HotMesh `app.id`
 * and Postgres schema name that isolates one server's workflows from another).
 *
 * ## Why lowercase alphanumeric, leading letter
 *
 * The server name becomes:
 *   1. A Postgres schema name — must start with a letter; letters and digits
 *      are safe without quoting.
 *   2. The first segment in the `mcp_<server>_<tool>` activity type encoding.
 *      Because underscores delimit server from tool, the server name itself
 *      must never contain underscores (or dashes, dots, etc.).
 *
 * ## Risks if violated
 *
 * - Underscores or dashes in the server name make `parseMcpActivityType()`
 *   split incorrectly — it uses the first `_` after `mcp_` as the boundary.
 * - A leading digit produces an invalid Postgres schema name that requires
 *   quoting and breaks HotMesh's unquoted SQL paths.
 * - Special characters can cause silent deployment failures or schema
 *   creation errors.
 *
 * ## Contract
 *
 * Input:  any string (LLM suggestion, user input, etc.)
 * Output: lowercase letters and digits only, guaranteed to start with a letter.
 *         All non-alphanumeric chars are stripped (not replaced).
 *         Leading digits are stripped so the result starts with a letter.
 *         Default: 'longtail' if the result is empty after sanitization.
 *
 * This is the ONE canonical frontend implementation. The backend has an
 * identical copy at `modules/utils.ts`. No other file in the platform
 * may inline this logic.
 */
export function sanitizeServerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[0-9]+/, '');
}
