// ── Process Claim prompts ───────────────────────────────────────────────────

export const ASSESS_DOCUMENT_QUALITY_PROMPT = `\
Assess this document image quality. Is the text readable and right-side up?
Return ONLY a JSON object: {"readable": true/false, "orientation": "normal"|"upside_down"|"rotated"|"unknown", "issues": ["list of issues"]}`;
