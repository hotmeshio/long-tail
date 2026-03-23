import type { McpServerRecord, McpToolManifest } from '../../../api/types';

export function isBuiltIn(row: McpServerRecord): boolean {
  return !!(row.metadata as Record<string, unknown> | null)?.builtin
    || !!(row.transport_config as Record<string, unknown> | null)?.builtin;
}

/** Check if a server or any of its tools match the search term */
export function matchesSearch(server: McpServerRecord, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  if (server.name.toLowerCase().includes(q)) return true;
  if (server.description?.toLowerCase().includes(q)) return true;
  const tools = (server.tool_manifest ?? []) as McpToolManifest[];
  return tools.some(
    (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
  );
}

/** Filter tools within a server that match the search term */
export function filterTools(tools: McpToolManifest[], search: string): McpToolManifest[] {
  if (!search) return tools;
  const q = search.toLowerCase();
  return tools.filter(
    (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
  );
}
