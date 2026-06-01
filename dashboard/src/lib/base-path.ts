/**
 * Runtime base path for subpath-mounted deployments.
 *
 * When the dashboard is mounted at a subpath (e.g. /admin/longtail),
 * the server injects `window.__LT_BASE__` via a <script> tag.
 * Standalone deployments leave it undefined (empty string fallback).
 */
export const LT_BASE: string = (window as any).__LT_BASE__ ?? '';
