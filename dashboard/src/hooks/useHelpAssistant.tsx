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
import {
  type HelpPageContext,
  type HelpMessage,
  type HelpAssistantContextValue,
  getDefaultTags,
  buildConversationPrefix,
  extractHelpContent,
  MAX_YAML_LENGTH,
} from './help-assistant-helpers';

// Re-export types for consumers
export type { HelpPageContext, HelpMessage, HelpAssistantContextValue };

const HelpAssistantContext = createContext<HelpAssistantContextValue | null>(null);

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

        // Attach workflow ID to the pending message for progress link
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id ? { ...m, workflowId: wfId } : m,
          ),
        );

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

              // Fetch execution data for duration
              let durationMs: number | undefined;
              try {
                const execData = await apiFetch<{ duration_ms?: number }>(
                  `/workflow-states/${wfId}/execution`,
                );
                durationMs = execData.duration_ms;
              } catch {
                // Duration is optional — don't block on failure
              }

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === pendingMsg.id ? { ...m, content, timestamp: new Date().toISOString(), pending: false, durationMs } : m,
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

  const compileMessage = useCallback(
    async (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg?.workflowId || msg.compilationStatus === 'compiling' || msg.compilationStatus === 'done') return;

      // Find the user message that preceded this assistant message
      const msgIndex = messages.indexOf(msg);
      const userMsg = messages.slice(0, msgIndex).reverse().find((m) => m.role === 'user');
      if (!userMsg) return;

      setMessages((prev) =>
        prev.map((m) => m.id === msgId ? { ...m, compilationStatus: 'compiling' as const } : m),
      );

      try {
        // Step 1: Describe — get tool name, description, tags
        const described = await apiFetch<{ tool_name: string; description: string; tags: string[] }>(
          '/insight/mcp-query/describe',
          {
            method: 'POST',
            body: JSON.stringify({
              prompt: userMsg.content,
              summary: msg.content,
            }),
          },
        );

        // Step 2: Compile — create YAML workflow
        const compiled = await apiFetch<{ id: string }>(
          '/yaml-workflows',
          {
            method: 'POST',
            body: JSON.stringify({
              workflow_id: msg.workflowId,
              task_queue: 'long-tail-system',
              workflow_name: 'mcpQuery',
              name: described.tool_name,
              description: described.description,
              tags: described.tags,
              app_id: '',
            }),
          },
        );

        // Step 3: Deploy
        await apiFetch(`/yaml-workflows/${compiled.id}/deploy`, {
          method: 'POST',
        });

        setMessages((prev) =>
          prev.map((m) => m.id === msgId ? { ...m, compilationStatus: 'done' as const } : m),
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Compilation failed';
        setMessages((prev) =>
          prev.map((m) => m.id === msgId ? { ...m, compilationStatus: 'error' as const, compilationError: errorMsg } : m),
        );
      }
    },
    [messages],
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
        compileMessage,
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
