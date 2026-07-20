import * as userService from '../services/user';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

// ── Self-service surface (/api/me) ─────────────────────────────────────────
// Operations on the AUTHENTICATED user only — no ids, no admin gates.

/**
 * The caller's preferences document — a generic per-user JSON store for
 * presentation state (pinned views are the first tenant). Always an object;
 * an unset store reads as {}.
 */
export async function getMyPreferences(auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const preferences = await userService.getPreferences(auth.userId);
    return { status: 200, data: { preferences } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Shallow-merge a patch into the caller's preferences. Top-level keys
 * overwrite; a `null` value deletes its key. The patch and the merged
 * document are both size-capped; the merge itself is a single guarded
 * UPDATE (no read-then-write).
 */
export async function patchMyPreferences(
  input: { patch: unknown },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { patch } = input;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { status: 400, error: 'Body must be a JSON object of preference keys' };
    }
    if (JSON.stringify(patch).length > userService.PREFERENCES_MAX_BYTES) {
      return { status: 413, error: `Preferences patch exceeds ${userService.PREFERENCES_MAX_BYTES} bytes` };
    }

    const preferences = await userService.patchPreferences(
      auth.userId,
      patch as Record<string, unknown>,
    );
    if (preferences === null) {
      return { status: 413, error: `Merged preferences would exceed ${userService.PREFERENCES_MAX_BYTES} bytes` };
    }
    return { status: 200, data: { preferences } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
