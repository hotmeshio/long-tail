import { getPool } from '../lib/db';
import type { LTApiResult } from '../types/sdk';

const LIST_SERVERS_WITH_TOOLS = `
  SELECT id, name, description, tags, tool_manifest, compile_hints, category
  FROM lt_mcp_servers
  WHERE status IN ('registered', 'connected')
    AND tool_manifest IS NOT NULL
  ORDER BY name
`;

interface CapabilityTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverName: string;
  serverId: string;
}

interface CapabilityCategory {
  name: string;
  tools: CapabilityTool[];
}

/**
 * Fallback tag-to-category mapping for servers that don't have an explicit category.
 */
const TAG_FALLBACK: Record<string, string> = {
  'escalation': 'Automation',
  'browser-automation': 'Automation',
  'translation': 'Analysis',
  'vision': 'Analysis',
  'gmail': 'Communication',
  'email': 'Communication',
  'messaging': 'Communication',
  'storage': 'Data',
  'knowledge': 'Data',
  'http': 'Data',
  'api': 'Data',
  'authentication': 'System',
  'admin': 'System',
  'documentation': 'Reference',
  'development': 'Development',
};

const CATEGORY_ORDER = ['Communication', 'Analysis', 'Data', 'Automation', 'Development', 'System', 'Reference', 'Other'];

function resolveCategory(server: { category?: string; tags?: string[] }): string {
  if (server.category) return server.category;
  for (const tag of server.tags ?? []) {
    const cat = TAG_FALLBACK[tag];
    if (cat) return cat;
  }
  return 'Other';
}

export async function listCapabilities(): Promise<LTApiResult> {
  try {
    const pool = getPool();
    const { rows } = await pool.query(LIST_SERVERS_WITH_TOOLS);

    const categoryMap = new Map<string, CapabilityTool[]>();

    for (const server of rows) {
      const category = resolveCategory(server);
      const tools = (server.tool_manifest || []) as Array<{ name: string; description: string; inputSchema?: Record<string, any> }>;

      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }

      for (const tool of tools) {
        categoryMap.get(category)!.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
          serverName: server.name,
          serverId: server.id,
        });
      }
    }

    const categories: CapabilityCategory[] = CATEGORY_ORDER
      .filter((name) => categoryMap.has(name))
      .map((name) => ({
        name,
        tools: categoryMap.get(name)!.sort((a, b) => a.name.localeCompare(b.name)),
      }));

    const totalTools = categories.reduce((sum, c) => sum + c.tools.length, 0);

    return { status: 200, data: { categories, totalTools } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
