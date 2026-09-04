/**
 * Link variables — per-device bindings for role-declared facet variables.
 *
 * A role declares variable names in `properties.link_variables`
 * (`{ name, label?, default? }[]`). Pinned URLs reference a variable as the
 * ENTIRE value of a facet inside the `facets` JSON param:
 * `facets={"facility":"{lt:facility}"}`. At render time the placeholder is
 * replaced with the device's bound value, falling back to the declared
 * default; when both are unset the facet is dropped (no filter). Bindings
 * live in localStorage keyed by userId (one key, whole map) so a shared
 * device remembers its station's scope, kiosk-store style. View convenience
 * only — RBAC still governs what any query can see.
 */

import { useSyncExternalStore } from 'react';

/** Whole-value placeholder: `{lt:name}` with the facet-key charset. */
export const LINK_VAR_RE = /^\{lt:([A-Za-z0-9_]+)\}$/;

export function makePlaceholder(name: string): string {
  return `{lt:${name}}`;
}

const KEY_PREFIX = 'lt:station:link-vars:';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// getSnapshot must be referentially stable between writes or
// useSyncExternalStore loops — cache the parsed map per raw string.
// `undefined` marks the cache invalid; a stored raw of `null` is a real state.
let cachedRaw: string | null | undefined = undefined;
let cachedMap: Record<string, string> = {};

export function getLinkVarValues(userId: string): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(userId));
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedMap;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    cachedMap = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>
      : {};
  } catch {
    cachedMap = {};
  }
  return cachedMap;
}

/** Set (non-empty string) or clear (null/empty) one binding. Whole-map write. */
export function setLinkVarValue(userId: string, name: string, value: string | null): void {
  const next = { ...getLinkVarValues(userId) };
  if (value === null || value === '') delete next[name];
  else next[name] = value;
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(storageKey(userId));
    else localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* storage unavailable — bindings are best-effort */
  }
  cachedRaw = undefined;
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(KEY_PREFIX)) {
      cachedRaw = undefined;
      listener();
    }
  };
  try {
    window.addEventListener('storage', onStorage);
  } catch {
    /* no window — subscribe still tracks in-process changes */
  }
  return () => {
    listeners.delete(listener);
    try {
      window.removeEventListener('storage', onStorage);
    } catch {
      /* no window */
    }
  };
}

const EMPTY: Record<string, string> = {};

/** React binding: the device's variable map for a user, reactive to changes. */
export function useLinkVarValues(userId: string | null): Record<string, string> {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? getLinkVarValues(userId) : EMPTY),
  );
}

/**
 * Substitute link-variable placeholders inside a URL's `facets` param.
 * Resolution per variable: device value → declared default → drop the facet.
 * Non-facets params, literal values, and unparseable URLs pass through
 * untouched; an emptied facets object removes the param entirely.
 */
export function substituteLinkVars(
  url: string,
  values: Record<string, string>,
  defaults: Record<string, string>,
): string {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://local');
  } catch {
    return url;
  }
  const rawFacets = parsed.searchParams.get('facets');
  if (!rawFacets) return url;
  let facets: Record<string, unknown>;
  try {
    const p = JSON.parse(rawFacets);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return url;
    facets = p as Record<string, unknown>;
  } catch {
    return url;
  }

  let changed = false;
  for (const [key, v] of Object.entries(facets)) {
    if (typeof v !== 'string') continue;
    const m = LINK_VAR_RE.exec(v);
    if (!m) continue;
    const bound = values[m[1]] ?? defaults[m[1]];
    if (typeof bound === 'string' && bound !== '') facets[key] = bound;
    else delete facets[key];
    changed = true;
  }
  if (!changed) return url;

  if (Object.keys(facets).length === 0) parsed.searchParams.delete('facets');
  else parsed.searchParams.set('facets', JSON.stringify(facets));
  return parsed.pathname + parsed.search;
}

/** The variable names a URL's `facets` param references (empty when none). */
export function extractLinkVarNames(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://local');
  } catch {
    return [];
  }
  const rawFacets = parsed.searchParams.get('facets');
  if (!rawFacets) return [];
  try {
    const facets = JSON.parse(rawFacets);
    if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return [];
    const names: string[] = [];
    for (const v of Object.values(facets)) {
      if (typeof v !== 'string') continue;
      const m = LINK_VAR_RE.exec(v);
      if (m && !names.includes(m[1])) names.push(m[1]);
    }
    return names;
  } catch {
    return [];
  }
}
