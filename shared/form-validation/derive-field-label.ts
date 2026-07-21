/**
 * Human-readable label for a schema field.
 *
 * Resolution order:
 * 1. The JSON Schema `title` keyword — the author's explicit label, always wins.
 * 2. Snake/kebab keys become Title Case: `left_quantity` → `Left Quantity`.
 * 3. Single-token keys pass through unchanged: `PO`, `SKU`, `LEFTQUANTITY` —
 *    a run of capitals carries no word boundaries to recover, and lowercasing
 *    would mangle acronyms. Authors who want prose labels declare `title`.
 *
 * Used everywhere a field name faces a human: form labels, dictionary lists,
 * the errors panel, and metadata displays.
 */
export function deriveFieldLabel(
  key: string,
  fieldSchema?: Record<string, unknown> | null,
): string {
  const title = fieldSchema?.title;
  if (typeof title === 'string' && title.trim().length > 0) return title.trim();

  const words = key.split(/[_-]+/).filter(Boolean);
  if (words.length <= 1) return key;

  return words
    .map((w) => (isCapsToken(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** All-caps tokens (PO, SKU, ID) keep their casing inside multi-word keys. */
function isCapsToken(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
}
