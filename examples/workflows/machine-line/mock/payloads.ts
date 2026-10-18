/**
 * Job artifacts: a dispatch names the file a unit needs by URL and SHA-256,
 * and the machine fetches and verifies it before accepting the job. The store
 * serves its own artifacts and can fetch any http(s) URL.
 */

import { createHash, randomUUID } from 'crypto';

export interface StoredPayload {
  id: string;
  url: string;
  sha256: string;
  size: number;
}

export const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export class PayloadStore {
  private items = new Map<string, Buffer>();

  /** `baseUrl` is how machines reach this store, e.g. http://machine-mock:8890. */
  constructor(public baseUrl = 'mock://site') {}

  put(bytes: Buffer): StoredPayload {
    const id = randomUUID();
    this.items.set(id, bytes);
    return { id, url: `${this.baseUrl}/payloads/${id}`, sha256: sha256Of(bytes), size: bytes.length };
  }

  get(id: string): Buffer | undefined {
    return this.items.get(id);
  }

  async verify(url: unknown, sha256: unknown): Promise<{ ok: boolean; detail: string }> {
    if (url === undefined || url === null || url === '') return { ok: true, detail: 'no artifact' };
    if (typeof url !== 'string' || typeof sha256 !== 'string') return { ok: false, detail: 'artifact url and sha256 must be strings' };
    let bytes: Buffer | undefined;
    const localPrefix = `${this.baseUrl}/payloads/`;
    if (url.startsWith(localPrefix)) {
      bytes = this.items.get(url.slice(localPrefix.length));
    } else if (/^https?:\/\//.test(url)) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) return { ok: false, detail: `artifact fetch ${res.status}` };
        bytes = Buffer.from(await res.arrayBuffer());
      } catch (err: any) {
        return { ok: false, detail: `artifact fetch failed: ${err.message}` };
      }
    } else {
      return { ok: false, detail: `unsupported artifact url ${url}` };
    }
    if (!bytes) return { ok: false, detail: 'artifact not found' };
    if (sha256Of(bytes) !== sha256.toLowerCase()) return { ok: false, detail: 'artifact checksum mismatch' };
    return { ok: true, detail: 'artifact verified' };
  }
}
