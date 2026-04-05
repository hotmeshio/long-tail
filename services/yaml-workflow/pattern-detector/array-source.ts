/**
 * Array source detection for iteration patterns.
 *
 * Locates prior step results that contain arrays matching the
 * iteration data, using key-overlap and length-match strategies.
 */

import type { ExtractedStepLike } from './types';

/**
 * Find a prior step whose result contains an array field that is the likely
 * data source for the iteration. Uses two strategies:
 *
 * 1. **Key overlap**: Array items have keys matching the iteration's varying keys
 *    (e.g., links[].href matches the varying key `url`)
 * 2. **Length match**: Array length matches the run length (fallback)
 *
 * Searches recursively through nested objects, returning a dot-path
 * (e.g., "links") so the YAML mapping references the correct depth.
 */
export function findArraySource(
  steps: ExtractedStepLike[],
  runStartIndex: number,
  runLength: number,
  varyingKeys?: string[],
): { stepIndex: number; fieldName: string } | null {
  // Strategy 1: Find array whose items have keys overlapping with varying keys
  if (varyingKeys && varyingKeys.length > 0) {
    for (let i = runStartIndex - 1; i >= 0; i--) {
      const result = steps[i].result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;

      const path = findArrayByKeyOverlap(result as Record<string, unknown>, varyingKeys, '');
      if (path) {
        return { stepIndex: i, fieldName: path };
      }
    }
  }

  // Strategy 2: Exact length match (fallback)
  for (let i = runStartIndex - 1; i >= 0; i--) {
    const result = steps[i].result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue;

    const path = findArrayByLength(result as Record<string, unknown>, runLength, '');
    if (path) {
      return { stepIndex: i, fieldName: path };
    }
  }

  return null;
}

/**
 * Find an array whose items contain keys that overlap with the iteration's
 * varying keys. For example, if varying keys are ['url', 'screenshot_path']
 * and a prior step returned { links: [{ text, href }, ...] }, the 'href'
 * key semantically matches 'url'. Returns the dot-path to the array.
 */
function findArrayByKeyOverlap(
  obj: Record<string, unknown>,
  varyingKeys: string[],
  prefix: string,
  maxDepth = 3,
): string | null {
  if (maxDepth <= 0) return null;

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0) {
      const firstItem = value[0];
      if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
        const itemKeys = Object.keys(firstItem as Record<string, unknown>);
        // Check if item keys overlap with varying keys or their semantic equivalents
        const hasOverlap = varyingKeys.some(vk =>
          itemKeys.includes(vk) ||
          itemKeys.some(ik => keysAreSemanticallyRelated(vk, ik)),
        );
        if (hasOverlap) {
          return prefix ? `${prefix}.${key}` : key;
        }
      }
    }
  }

  // Recurse into nested objects
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findArrayByKeyOverlap(
        value as Record<string, unknown>,
        varyingKeys,
        prefix ? `${prefix}.${key}` : key,
        maxDepth - 1,
      );
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Check if two keys are semantically related.
 * E.g., 'url' and 'href', 'path' and 'screenshot_path'.
 */
function keysAreSemanticallyRelated(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  // One contains the other
  if (la.includes(lb) || lb.includes(la)) return true;
  // URL-like equivalences
  const urlKeys = ['url', 'href', 'link', 'src'];
  if (urlKeys.includes(la) && urlKeys.includes(lb)) return true;
  // Path-like equivalences
  const pathKeys = ['path', 'file', 'filepath', 'filename'];
  if (pathKeys.some(p => la.includes(p)) && pathKeys.some(p => lb.includes(p))) return true;
  // Name/label equivalences (nav link text often maps to filenames)
  const nameKeys = ['name', 'text', 'label', 'title'];
  if (nameKeys.includes(la) && nameKeys.includes(lb)) return true;
  return false;
}

/** Find an array by exact length match (fallback strategy). */
function findArrayByLength(
  obj: Record<string, unknown>,
  targetLength: number,
  prefix: string,
  maxDepth = 3,
): string | null {
  if (maxDepth <= 0) return null;

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length === targetLength) {
      return prefix ? `${prefix}.${key}` : key;
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findArrayByLength(
        value as Record<string, unknown>,
        targetLength,
        prefix ? `${prefix}.${key}` : key,
        maxDepth - 1,
      );
      if (nested) return nested;
    }
  }

  return null;
}
