import { Wand2, Blocks } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

/**
 * "Design" — the LLM authoring add-on. The Designer compiles MCP tool runs and
 * plain descriptions into Graph flows. Appears when an Anthropic key is configured.
 */
const entries: NavEntry[] = [
  { to: '/mcp/queries', label: 'Designer', icon: Wand2 },
  { to: '/mcp/servers', label: 'Servers & Tools', icon: Blocks },
];

export function DesignSidebar() {
  return <SidebarNav heading="Design" entries={entries} />;
}
