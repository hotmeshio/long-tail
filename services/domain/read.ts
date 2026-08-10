import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { CONFIG_CACHE_TTL_MS } from '../../modules/defaults';
import type { DomainDictionary, DomainIndex, DomainTermKind } from '../../types';
import { GET_DOMAIN } from './sql';

export interface DomainRecord {
  doc: DomainDictionary;
  version: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Read-through TTL cache (same shape as modules/ltconfig.ts): the dictionary
// rides the MCP `instructions` of every /mcp request, so reads must be
// in-memory between refreshes and MUST fail soft — a dead DB yields null
// (no instructions, "no dictionary registered" tool response), never a
// rejected request. Writes call invalidate(); other containers converge
// within one TTL window.
// ---------------------------------------------------------------------------
class DomainCache {
  private record: DomainRecord | null = null;
  private loadedAt = 0;
  private loadPromise: Promise<DomainRecord | null> | null = null;

  async get(): Promise<DomainRecord | null> {
    if (this.loadedAt && Date.now() - this.loadedAt < CONFIG_CACHE_TTL_MS) {
      return this.record;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.load().finally(() => {
        this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  private async load(): Promise<DomainRecord | null> {
    try {
      const { rows } = await getPool().query(GET_DOMAIN);
      this.record = rows[0]
        ? { doc: rows[0].doc, version: rows[0].version, updated_at: rows[0].updated_at }
        : null;
    } catch (err: any) {
      loggerRegistry.warn(`[lt-domain] dictionary read failed: ${err.message}`);
      this.record = null;
    }
    this.loadedAt = Date.now();
    return this.record;
  }

  /** Force reload on next access. Call after writes. */
  invalidate(): void {
    this.record = null;
    this.loadedAt = 0;
    this.loadPromise = null;
  }
}

export const domainCache = new DomainCache();

/** The dictionary, or null when none is registered (or the read failed). */
export async function getDomainDictionary(): Promise<DomainRecord | null> {
  return domainCache.get();
}

/** Compact names-only index for the MCP `instructions` string. */
export async function getDomainIndex(): Promise<DomainIndex | null> {
  const record = await domainCache.get();
  if (!record) return null;
  const { doc } = record;
  const terms: Partial<Record<DomainTermKind, string[]>> = {};
  for (const t of doc.terms ?? []) {
    (terms[t.kind] ??= []).push(t.term);
  }
  return {
    name: doc.name,
    version: doc.version,
    overview: doc.overview,
    terms,
    runbooks: (doc.runbooks ?? []).map((r) => r.name),
  };
}
