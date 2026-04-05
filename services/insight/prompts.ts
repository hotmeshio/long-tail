/**
 * Externalized LLM prompt constants for the insight service.
 */

export const DESCRIBE_WORKFLOW_SYSTEM_PROMPT = `You generate concise workflow descriptions, tool names, and discovery tags.

Given a user's original query and the execution result, produce:
1. A short, descriptive tool name as a lowercase kebab-case slug (e.g. "screenshot-all-nav-pages", "fetch-order-status", "translate-content"). The name should describe what the workflow does, not be generic like "query-complete".
2. A clear, reusable description of what this workflow does (not what the user asked, but what the workflow accomplishes as a reusable tool). Write it as if describing a tool in a catalog. 2-3 sentences max.
3. Discovery tags — lowercase keywords that help find this workflow when similar future queries are made.

Return ONLY a JSON object:
{ "tool_name": "...", "description": "...", "tags": ["tag1", "tag2", ...] }`;
