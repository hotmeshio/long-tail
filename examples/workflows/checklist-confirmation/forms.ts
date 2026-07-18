/**
 * Checklist Confirmation — role interface for the checklist widget example.
 *
 * The `checklist-operator` role owns a stable form_schema with a single `items`
 * field backed by the `checklist` widget. Item definitions live in the escalation
 * envelope (`checklist_items: [{ id, label }]`), supplied at runtime by the
 * workflow — no GIN indexing cost, since these are render-only labels.
 *
 * Use `metadata` for facets that need to be searched or filtered (e.g. orderId,
 * station). Use `envelope` or `payload` for form render data that the workflow
 * carries forward but that long-tail never needs to query over.
 */

export const CHECKLIST_ROLE = 'checklist-operator';
export const CHECKLIST_SCHEMA_VERSION = 1;

/**
 * The payload shape the workflow receives from conditionLT. Each key is an item
 * id; the value is true (confirmed) or false (not confirmed). Validate with zod
 * if you want runtime guarantees beyond TypeScript.
 */
export interface ChecklistResolverV1 {
  items: Record<string, boolean>;
}

/**
 * Stable role-owned form schema. The checklist widget resolves item labels from
 * `envelope.checklist_items` at render time — the schema itself never changes
 * as item count or labels change across escalations.
 */
export const CHECKLIST_FORM_SCHEMA = {
  title: 'Checklist Confirmation',
  description: 'Check each item to confirm it has been completed.',
  required: ['items'],
  properties: {
    items: {
      type: 'object',
      description: 'Work through each step and check it off.',
      'x-lt-widget': 'checklist',
      // envelope is the right domain for render data — no index cost.
      // Swap to metadata.checklist_items if items need to be GIN-queryable.
      'x-lt-source': 'envelope.checklist_items',
    },
  },
};
