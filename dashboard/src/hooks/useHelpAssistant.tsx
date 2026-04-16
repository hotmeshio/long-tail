import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../api/client';

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
}

interface HelpAssistantContextValue {
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  toggleHelp: () => void;
  messages: HelpMessage[];
  sendMessage: (text: string) => void;
  pageContext: HelpPageContext;
  setPageContext: (ctx: Partial<HelpPageContext>) => void;
  activeWorkflowId: string | null;
  clearMessages: () => void;
}

const HelpAssistantContext = createContext<HelpAssistantContextValue | null>(null);

// ── Default tag map ──────────────────────────────────────────────────────────

function getDefaultTags(pathname: string): string[] | undefined {
  if (pathname.includes('/escalations')) return ['escalation', 'human-queue'];
  // No tag filter by default — let mcpQuery discover all available tools
  return undefined;
}

// ── Conversation history builder ─────────────────────────────────────────────

const MAX_HISTORY_EXCHANGES = 4;
const MAX_YAML_LENGTH = 2000;

function buildConversationPrefix(messages: HelpMessage[]): string {
  const completed = messages.filter((m) => !m.pending);
  const recent = completed.slice(-MAX_HISTORY_EXCHANGES * 2);
  if (recent.length === 0) return '';

  const lines = recent.map(
    (m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
  );
  return `[Prior conversation]\n${lines.join('\n')}\n[End prior conversation]\n\n`;
}

/** Extract human-readable content from mcpQuery result, stripping raw JSON. */
function extractHelpContent(result: Record<string, unknown>): string {
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

// ── Provider ─────────────────────────────────────────────────────────────────

export function HelpAssistantProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [pageCtxOverride, setPageCtxOverride] = useState<Partial<HelpPageContext>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-derived page context from route
  const pageContext: HelpPageContext = {
    page: location.pathname.split('/').filter(Boolean).join('-') || 'home',
    route: location.pathname,
    params: {},
    ...pageCtxOverride,
    suggestedTags: pageCtxOverride.suggestedTags ?? getDefaultTags(location.pathname),
  };

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const toggleHelp = useCallback(() => setHelpOpen((v) => !v), []);

  const setPageContext = useCallback((ctx: Partial<HelpPageContext>) => {
    setPageCtxOverride(ctx);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setActiveWorkflowId(null);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const now = new Date().toISOString();
      const userMsg: HelpMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: now,
      };
      const pendingMsg: HelpMessage = {
        id: `pending-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: now,
        pending: true,
      };

      setMessages((prev) => [...prev, userMsg, pendingMsg]);

      // Truncate yaml in context
      const ctx = { ...pageContext };
      if (ctx.entities?.yamlContent && ctx.entities.yamlContent.length > MAX_YAML_LENGTH) {
        ctx.entities = {
          ...ctx.entities,
          yamlContent: ctx.entities.yamlContent.slice(0, MAX_YAML_LENGTH) + '\n... (truncated)',
        };
      }

      // Build enriched prompt with conversation history
      const historyPrefix = buildConversationPrefix(
        messages.concat(userMsg),
      );
      const enrichedPrompt = `${historyPrefix}${text}`;

      try {
        const data = await apiFetch<{ workflow_id: string }>('/insight/mcp-query', {
          method: 'POST',
          body: JSON.stringify({
            prompt: enrichedPrompt,
            tags: ctx.suggestedTags,
            context: ctx,
            wait: false,
            direct: true,
          }),
        });

        const wfId = data.workflow_id;
        setActiveWorkflowId(wfId);

        // Poll for result
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const resultData = await apiFetch<{
              result?: { data?: Record<string, unknown> };
            }>(`/workflows/${wfId}/result`);
            const result = resultData?.result?.data;
            if (result) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setActiveWorkflowId(null);

              const content = extractHelpContent(result);

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === pendingMsg.id ? { ...m, content, timestamp: new Date().toISOString(), pending: false } : m,
                ),
              );
            }
          } catch {
            // Keep polling — result not ready yet
          }
        }, 3000);
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? { ...m, content: 'Failed to submit query. Please try again.', pending: false }
              : m,
          ),
        );
      }
    },
    [messages, pageContext],
  );

  return (
    <HelpAssistantContext.Provider
      value={{
        helpOpen,
        setHelpOpen,
        toggleHelp,
        messages,
        sendMessage,
        pageContext,
        setPageContext,
        activeWorkflowId,
        clearMessages,
      }}
    >
      {children}
    </HelpAssistantContext.Provider>
  );
}

export function useHelpAssistant(): HelpAssistantContextValue {
  const ctx = useContext(HelpAssistantContext);
  if (!ctx) throw new Error('useHelpAssistant must be used within HelpAssistantProvider');
  return ctx;
}
