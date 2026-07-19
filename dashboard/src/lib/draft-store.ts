/**
 * Local draft persistence for the resolver form. Edits are saved per
 * escalation while the user works and restored when they return — a lapsed
 * claim or an accidental navigation never loses typed input. The draft is
 * cleared when the escalation reaches a terminal state through this client
 * (resolved, acknowledged, or cancelled).
 */

const DRAFT_KEY_PREFIX = 'lt:escalation:draft:';

function draftKey(escalationId: string): string {
  return `${DRAFT_KEY_PREFIX}${escalationId}`;
}

export function readDraft(escalationId: string): string | null {
  try {
    return localStorage.getItem(draftKey(escalationId));
  } catch {
    return null;
  }
}

export function saveDraft(escalationId: string, json: string): void {
  try {
    localStorage.setItem(draftKey(escalationId), json);
  } catch {
    /* storage unavailable or full — drafts are best-effort */
  }
}

export function clearDraft(escalationId: string): void {
  try {
    localStorage.removeItem(draftKey(escalationId));
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
