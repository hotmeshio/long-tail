import { Wand2, Blocks } from 'lucide-react';
import { SidebarNav, type NavEntry } from './SidebarNav';

/**
 * "Design" — the optional LLM authoring add-on (requires an Anthropic key).
 * The Designer compiles MCP tool runs and plain descriptions into Graph flows.
 * Running existing Procedural and Graph flows needs none of this; without a key
 * the section is simply hidden and the rest of the system stands on its own.
 */
const entries: NavEntry[] = [
  { to: '/mcp/queries', label: 'Designer', icon: Wand2 },
  { to: '/mcp/servers', label: 'Servers & Tools', icon: Blocks },
];

export function DesignSidebar() {
  return <SidebarNav heading="Design" entries={entries} />;
}
