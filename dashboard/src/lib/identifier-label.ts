/**
 * A human label for a code identifier: camelCase, snake_case, kebab-case, and
 * digit runs become Title Case words. `fleetTools` → `Fleet Tools`,
 * `print_order2` → `Print Order 2`. Acronyms keep their capitals: `mcpQuery`
 * → `Mcp Query` is avoided by treating an all-caps run as one word.
 */
export function identifierToTitle(id: string): string {
  const words = id
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
