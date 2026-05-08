/**
 * Externalized LLM prompt constants for the insight service.
 */

export const DESCRIBE_WORKFLOW_SYSTEM_PROMPT = `You generate concise workflow descriptions, tool names, and discovery tags.

Given a user's original query and the execution result, produce:
1. A short, descriptive tool name in snake_case (e.g. "screenshot_all_nav_pages", "fetch_order_status", "translate_content"). Only lowercase letters, digits, and underscores. The name should describe what the workflow does, not be generic like "query_complete".
2. A clear, reusable description of what this workflow does (not what the user asked, but what the workflow accomplishes as a reusable tool). Write it as if describing a tool in a catalog. 2-3 sentences max.
3. Discovery tags — lowercase keywords that help find this workflow when similar future queries are made.

Return ONLY a JSON object:
{ "tool_name": "...", "description": "...", "tags": ["tag1", "tag2", ...] }`;
