import bcrypt from 'bcryptjs';

import {
  KEY_DIGEST_MISS_MEMO_MAX,
  KEY_DIGEST_MISS_MEMO_SECONDS,
} from '../../modules/defaults';

/** Storage for secrets whose rows may have a bcrypt hash and no digest. */
export interface DigestAdoptionStore {
  listWithoutDigest(): Promise<{ id: string; hash: string }[]>;
  setDigest(id: string, digest: string): Promise<void>;
}

export type AdoptDigest = (rawSecret: string, digest: string) => Promise<boolean>;

/**
 * Builds the function that gives a digest-less row its digest the first time
 * its secret is presented. Passes run one at a time, concurrent presentations
 * of one secret share a pass, and a secret that matched no row is remembered
 * for a short time, so a repeated unknown secret costs no further bcrypt work.
 */
export function createDigestAdopter(store: DigestAdoptionStore): AdoptDigest {
  const inFlight = new Map<string, Promise<boolean>>();
  const missedUntil = new Map<string, number>();
  let lastPass: Promise<unknown> = Promise.resolve();

  async function matchStoredHash(rawSecret: string, digest: string): Promise<boolean> {
    for (const row of await store.listWithoutDigest()) {
      if (await bcrypt.compare(rawSecret, row.hash)) {
        await store.setDigest(row.id, digest);
        return true;
      }
    }
    return false;
  }

  function hasRecentMiss(digest: string): boolean {
    const until = missedUntil.get(digest);
    if (until === undefined) return false;
    if (until > performance.now()) return true;
    missedUntil.delete(digest);
    return false;
  }

  function rememberMiss(digest: string): void {
    if (missedUntil.size >= KEY_DIGEST_MISS_MEMO_MAX) {
      missedUntil.delete(missedUntil.keys().next().value as string);
    }
    missedUntil.set(digest, performance.now() + KEY_DIGEST_MISS_MEMO_SECONDS * 1000);
  }

  return function adoptDigest(rawSecret, digest) {
    if (hasRecentMiss(digest)) return Promise.resolve(false);
    let pass = inFlight.get(digest);
    if (!pass) {
      pass = lastPass
        .then(() => matchStoredHash(rawSecret, digest))
        .then((matched) => {
          if (!matched) rememberMiss(digest);
          return matched;
        })
        .finally(() => inFlight.delete(digest));
      inFlight.set(digest, pass);
      lastPass = pass.catch(() => undefined);
    }
    return pass;
  };
}
