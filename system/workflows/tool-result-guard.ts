/**
 * Tool result size guard for agentic loops.
 *
 * Prevents oversized tool results (e.g. base64 image data) from
 * bloating the LLM message history and exceeding token limits.
 */

import { TOOL_RESULT_MAX_CHARS } from '../../modules/defaults';

const BASE64_IMAGE_PATTERN = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{1000,}/;
const RAW_BASE64_PATTERN = /^[A-Za-z0-9+/=]{10000,}$/;

/**
 * Sanitize a tool result for inclusion in the LLM message history.
 *
 * - If the serialized result is within limits, returns it unchanged.
 * - If it contains base64 image data, strips the binary and adds guidance.
 * - Otherwise truncates with a preview.
 */
export function sanitizeToolResult(result: any): string {
  const serialized = JSON.stringify(result);

  if (serialized.length <= TOOL_RESULT_MAX_CHARS) {
    return serialized;
  }

  // Detect base64 image data in the result
  if (BASE64_IMAGE_PATTERN.test(serialized) || hasRawBase64Content(result)) {
    const cleaned = stripBinaryFields(result);
    return JSON.stringify({
      ...cleaned,
      _truncated: true,
      _reason: 'Image binary data removed to stay within token limits',
      _guidance: 'Use the analyze_image or describe_image tool with the file path to examine this image.',
    });
  }

  // Generic oversized result — keep a preview
  return JSON.stringify({
    _truncated: true,
    _reason: `Tool result exceeded ${TOOL_RESULT_MAX_CHARS} characters (was ${serialized.length})`,
    _preview: serialized.slice(0, 2000),
  });
}

/**
 * Check if any string field in the result looks like raw base64 content.
 */
function hasRawBase64Content(obj: any): boolean {
  if (typeof obj === 'string') return RAW_BASE64_PATTERN.test(obj);
  if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      if (hasRawBase64Content(val)) return true;
    }
  }
  return false;
}

/**
 * Return a shallow copy with large base64 string fields replaced by a placeholder.
 * Preserves non-binary metadata (path, size, url, etc.).
 */
function stripBinaryFields(obj: any): any {
  if (typeof obj === 'string') {
    if (RAW_BASE64_PATTERN.test(obj)) return '[base64 image data removed]';
    if (BASE64_IMAGE_PATTERN.test(obj)) return obj.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[base64 image data removed]');
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(stripBinaryFields);
  if (obj && typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      cleaned[key] = stripBinaryFields(val);
    }
    return cleaned;
  }
  return obj;
}
