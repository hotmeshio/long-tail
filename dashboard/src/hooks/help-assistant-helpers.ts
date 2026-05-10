// ── Types ────────────────────────────────────────────────────────────────────

export interface HelpPageContext {
  page: string;
  route: string;
  params: Record<string, string>;
  entities?: {
    workflowId?: string;
    workflowStatus?: string;
    yamlContent?: string;
    escalationId?: string;
    prompt?: string;
  };
  suggestedTags?: string[];
}

export interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  pending?: boolean;
  workflowId?: string;
  durationMs?: number;
  compilationStatus?: 'idle' | 'compiling' | 'done' | 'error';
  compilationError?: string;
}

export interface HelpAssistantContextValue {
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  toggleHelp: () => void;
  messages: HelpMessage[];
  sendMessage: (text: string) => void;
  pageContext: HelpPageContext;
  setPageContext: (ctx: Partial<HelpPageContext>) => void;
  activeWorkflowId: string | null;
  clearMessages: () => void;
  compileMessage: (msgId: string) => void;
}

// ── Default tag map ──────────────────────────────────────────────────────────

export function getDefaultTags(pathname: string): string[] | undefined {
  if (pathname.includes('/escalations')) return ['escalation', 'human-queue'];
  // No tag filter by default — let mcpQuery discover all available tools
  return undefined;
}

// ── Conversation history builder ─────────────────────────────────────────────

const MAX_HISTORY_EXCHANGES = 4;
export const MAX_YAML_LENGTH = 2000;

export function buildConversationPrefix(messages: HelpMessage[]): string {
  const completed = messages.filter((m) => !m.pending);
  const recent = completed.slice(-MAX_HISTORY_EXCHANGES * 2);
  if (recent.length === 0) return '';

  const lines = recent.map(
    (m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
  );
  return `[Prior conversation]\n${lines.join('\n')}\n[End prior conversation]\n\n`;
}

/** Extract human-readable content from mcpQuery result, stripping raw JSON. */
export function extractHelpContent(result: Record<string, unknown>): string {
  const summary = result.summary as string | undefined;
  const title = result.title as string | undefined;

  if (summary) {
    // The LLM sometimes embeds JSON at the end of the summary — strip it
    const jsonTail = summary.search(/\n\s*\{[\s\S]*"title"\s*:/);
    if (jsonTail > 0) return summary.slice(0, jsonTail).trim();
    return summary;
  }

  if (title) return title;

  return typeof result === 'string' ? result : 'Query completed.';
}
