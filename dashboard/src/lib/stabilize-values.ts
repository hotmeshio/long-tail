/**
 * Re-parsing the form's JSON on every edit hands back a fresh object for every
 * field. Reusing the previous object wherever the content is equal keeps
 * unchanged fields referentially stable, so only the field that changed
 * re-renders.
 */
export function stabilizeValues<T extends Record<string, unknown>>(previous: T, next: T): T {
  let allSame = Object.keys(previous).length === Object.keys(next).length;
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    const prior = previous[key];
    const reuse = key in previous && (prior === value || JSON.stringify(prior) === JSON.stringify(value));
    merged[key] = reuse ? prior : value;
    if (!reuse) allSame = false;
  }
  return allSame ? previous : (merged as T);
}
