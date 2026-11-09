import path from 'path';

import { config } from '../../modules/config';
import { getStorageBackend } from '../../lib/storage';
import { mimeFromPath } from '../../lib/storage/mime';
import {
  ESCALATION_ENVELOPE_KEYS,
  ESCALATION_FILE_REFS_MAX,
  fileRefProblem,
  normalizeFileRefPath,
  type EscalationFileRef,
  type LTEscalationRecord,
} from '../../types/escalation';

/** One file ref answered: a signed link, or the reason there is none. */
export interface EscalationFileLink {
  as: string;
  path: string;
  name: string;
  contentType: string;
  url?: string;
  expiresAt?: string;
  error?: string;
}

/**
 * The refs riding the row's envelope under the reserved key, each checked
 * again at read time: an engine-written envelope can carry refs that never
 * passed the creation check, and nothing outside the store is ever signed.
 */
export function readFileRefs(
  envelope: string | Record<string, unknown> | null | undefined,
): Array<EscalationFileRef | { error: string; ref: unknown }> {
  if (!envelope) return [];
  let refs: unknown;
  try {
    const parsed = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
    refs = parsed && typeof parsed === 'object' ? parsed[ESCALATION_ENVELOPE_KEYS.FILES] : undefined;
  } catch {
    return [];
  }
  if (!Array.isArray(refs)) return [];
  const seen = new Set<string>();
  return refs.slice(0, ESCALATION_FILE_REFS_MAX).map((ref) => {
    const problem = fileRefProblem(ref);
    if (problem) return { error: problem, ref };
    const alias = (ref as EscalationFileRef).as;
    if (seen.has(alias)) return { error: `File ref ${alias}: "as" names more than one file`, ref };
    seen.add(alias);
    return ref as EscalationFileRef;
  });
}

/**
 * The `file` form domain without links, keyed by each ref's `as`: what the
 * server's validation pass sees, so a condition on a file's presence
 * evaluates the same on both sides of the wire.
 */
export function fileContext(
  envelope: string | Record<string, unknown> | null | undefined,
): Record<string, Pick<EscalationFileLink, 'as' | 'path' | 'name' | 'contentType'>> | null {
  const entries = readFileRefs(envelope).filter((r): r is EscalationFileRef => !('error' in r));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map((ref) => {
    const key = normalizeFileRefPath(ref.path)!;
    return [ref.as, {
      as: ref.as,
      path: key,
      name: ref.name ?? path.posix.basename(key),
      contentType: ref.contentType ?? mimeFromPath(key),
    }];
  }));
}

/** Seconds left on the reader's own live claim, or 0. */
export function claimSecondsLeft(
  escalation: Pick<LTEscalationRecord, 'assigned_to' | 'assigned_until'>,
  userId: string,
  now = Date.now(),
): number {
  if (!escalation.assigned_to || escalation.assigned_to !== userId || !escalation.assigned_until) return 0;
  const until = new Date(escalation.assigned_until).getTime();
  return Number.isFinite(until) && until > now ? Math.ceil((until - now) / 1000) : 0;
}

/**
 * How long a link lives: the ref's ask (else the default), stretched to
 * cover the reader's live claim, held within the configured bounds.
 */
export function fileLinkSeconds(ref: Pick<EscalationFileRef, 'expiresIn'>, claimSeconds: number): number {
  const asked = ref.expiresIn ?? config.LT_ESCALATION_FILE_URL_TTL_SECONDS;
  const wanted = Math.max(asked, claimSeconds);
  const min = config.LT_ESCALATION_FILE_URL_MIN_SECONDS;
  const max = Math.max(min, config.LT_ESCALATION_FILE_URL_MAX_SECONDS);
  return Math.min(Math.max(wanted, min), max);
}

/**
 * Sign every ref. Signing is local to the process (no storage round trip),
 * so a page open costs one signature per file. A ref that cannot be signed
 * answers with `error`; the batch never fails.
 */
export async function signFileRefs(
  refs: ReturnType<typeof readFileRefs>,
  claimSeconds: number,
  now = Date.now(),
): Promise<EscalationFileLink[]> {
  const storage = getStorageBackend();
  return Promise.all(refs.map(async (entry): Promise<EscalationFileLink> => {
    if ('error' in entry) {
      const raw = (entry.ref ?? {}) as Record<string, unknown>;
      return {
        as: typeof raw.as === 'string' ? raw.as : '',
        path: typeof raw.path === 'string' ? raw.path : '',
        name: '',
        contentType: '',
        error: entry.error,
      };
    }
    const key = normalizeFileRefPath(entry.path)!;
    const link: EscalationFileLink = {
      as: entry.as,
      path: key,
      name: entry.name ?? path.posix.basename(key),
      contentType: entry.contentType ?? mimeFromPath(key),
    };
    const seconds = fileLinkSeconds(entry, claimSeconds);
    try {
      link.url = await storage.getSignedUrl(key, seconds);
      link.expiresAt = new Date(now + seconds * 1000).toISOString();
    } catch (err: any) {
      link.error = err?.message ?? 'The file link could not be signed';
    }
    return link;
  }));
}
