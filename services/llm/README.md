Model-agnostic LLM service. Single entry point (`callLLM()`) for all LLM calls in the application. Auto-detects the provider from the model name and routes to the appropriate SDK.

Key files:
- `index.ts` — `callLLM(options)` and `hasLLMApiKey(model?)`. Lazy-loads provider singletons.
- `detect.ts` — `detectProvider(model)` maps model name prefixes to providers: `gpt-*/o1-*/o3-*/o4-*` -> openai, `claude-*` -> anthropic, everything else -> openai-compatible. `resolveApiKey(provider)` reads the appropriate env var.
- `translate.ts` — Bidirectional message/tool/response translation between OpenAI (canonical format) and Anthropic. Handles system message extraction, tool_use/tool_result blocks, content part translation (text + images), and Anthropic's alternating-role requirement.
- `types.ts` — Shared types: `LLMOptions`, `LLMResponse`, `ChatMessage`, `ToolDefinition`, `ToolCall`, `ContentPart`
- `providers/openai.ts` — OpenAI SDK wrapper (also used for OpenAI-compatible endpoints via `LT_LLM_BASE_URL`)
- `providers/anthropic.ts` — Anthropic SDK wrapper using the translation layer

No SQL. No inline LLM prompts — this service is the transport layer, not a prompt author. Env vars: `LT_LLM_MODEL_PRIMARY`, `LT_LLM_MODEL_SECONDARY`, `LT_LLM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LT_LLM_BASE_URL`.
