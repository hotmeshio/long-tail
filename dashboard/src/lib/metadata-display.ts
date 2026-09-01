/** Metadata keys that are plumbing, not information for the person working the item.
 * batch_pending/batch_count stay visible — they are the batch progress facets. */
const HIDDEN_METADATA_KEYS = new Set(['form_schema', 'batch_keys']);

/**
 * The metadata entries a person should see: platform plumbing (the embedded
 * form schema, underscore-prefixed keys) is filtered out of every facet
 * listing — the side panel, the scan info-choice screen, and any future
 * surface that walks a row's metadata.
 */
export function displayMetadataEntries(
  metadata: Record<string, unknown> | null | undefined,
): [string, unknown][] {
  return Object.entries(metadata ?? {}).filter(
    ([k]) => !k.startsWith('_') && !HIDDEN_METADATA_KEYS.has(k),
  );
}
