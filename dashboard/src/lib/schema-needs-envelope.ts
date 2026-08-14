/**
 * List rows arrive without the heavyweight `envelope`/`escalation_payload`
 * columns by default. A surface driven by an x-lt schema fragment opts back in
 * only when the fragment actually interpolates those domains — `envelope.` or
 * `payload.` in any token, condition, or source path. `metadata.` and
 * `resolver.` ride the slim rows and never trigger the opt-in.
 */
export function schemaNeedsEnvelope(fragment: unknown): boolean {
  if (!fragment) return false;
  try {
    const s = JSON.stringify(fragment);
    return s.includes('envelope.') || s.includes('payload.');
  } catch {
    return false;
  }
}
