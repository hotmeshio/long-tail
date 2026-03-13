// ── Verify Document prompts ─────────────────────────────────────────────────

/**
 * Build the member-info extraction prompt for the given page number.
 */
export function EXTRACT_MEMBER_INFO_PROMPT(pageNumber: number): string {
  return `Extract member information from this document image (page ${pageNumber}).

Return ONLY a valid JSON object:
{
  "memberId": "string or null",
  "name": "string or null",
  "address": { "street": "string", "city": "string", "state": "string", "zip": "string" },
  "phone": "string or null",
  "email": "string or null",
  "emergencyContact": { "name": "string", "phone": "string" }
}

Include only fields visible in the image. Omit fields not found.
Return raw JSON only — no markdown fences, no explanation.`;
}
