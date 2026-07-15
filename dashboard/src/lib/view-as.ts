const VIEW_AS_KEY = 'lt_view_as';
const AI_OVERRIDE_KEY = 'lt_ai_override';

/** Returns the local AI override, or null if no override is set (falls back to server setting). */
export function getAiOverride(): boolean | null {
  try {
    const v = localStorage.getItem(AI_OVERRIDE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch { /* localStorage unavailable */ }
  return null;
}

export function setAiOverride(enabled: boolean): void {
  try { localStorage.setItem(AI_OVERRIDE_KEY, String(enabled)); } catch {}
}

export function clearAiOverride(): void {
  try { localStorage.removeItem(AI_OVERRIDE_KEY); } catch {}
}

export type ViewAsRole = 'admin' | 'engineer' | 'operator';

export function getViewAs(): ViewAsRole | null {
  try {
    const v = localStorage.getItem(VIEW_AS_KEY);
    if (v === 'admin' || v === 'engineer' || v === 'operator') return v;
  } catch { /* localStorage unavailable */ }
  return null;
}

export function setViewAs(role: ViewAsRole): void {
  try { localStorage.setItem(VIEW_AS_KEY, role); } catch {}
  window.location.reload();
}

export function clearViewAs(): void {
  try { localStorage.removeItem(VIEW_AS_KEY); } catch {}
  window.location.reload();
}
