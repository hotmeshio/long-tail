// ── _handle convention ──────────────────────────────────────────────────────
//
// Tools that create external state (browser pages, file handles, connections)
// return a `_handle` object in their result. The handle contains everything
// needed to locate the resource from any container:
//
//   _handle: {
//     type: "playwright_page",
//     cdp_endpoint: "ws://host:port/...",   // CDP WebSocket (cross-container)
//     page_id: "page_3",                     // local in-memory lookup (fast path)
//   }
//
// Subsequent tools accept `_handle` and use it to reconnect:
// 1. Fast path: check local `pages` Map by page_id (same container)
// 2. Slow path: connect via CDP endpoint (different container / cloud)
//
// The YAML generator threads `_handle` automatically between sequential
// activities from the same server. No hardcoded tool-pair knowledge needed.

export interface PlaywrightHandle {
  type: 'playwright_page';
  cdp_endpoint?: string;
  page_id: string;
}

// ── Standard error codes for stateful resource tools ────────────────────────
// Any MCP server managing stateful resources should use these codes:
//   SESSION_NOT_FOUND    — resource ID unknown (never existed or already cleaned up)
//   SESSION_EXPIRED      — resource was closed / cleaned up
//   SESSION_UNREACHABLE  — remote endpoint (e.g. CDP) not reachable
//   RESOURCE_NOT_FOUND   — sub-resource (element, file) not found within session
export const SESSION_NOT_FOUND = 'SESSION_NOT_FOUND';
export const SESSION_UNREACHABLE = 'SESSION_UNREACHABLE';
export const RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND';
