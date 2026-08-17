/**
 * Lookup-cascade role interface — the reference example for versioned
 * knowledge lookups (docs/hitl/lookups.md):
 *
 *   - x-lt-options from the `lookup.*` domain: the material select offers the
 *     items of the knowledge edition the escalation pins — different rows can
 *     pin different editions of the SAME entry under ONE role form
 *   - cascading selects: the region select's options ride
 *     `lookup.geo.regions.{{resolver.country}}` — disabled until a country is
 *     chosen, populated the moment one is, re-resolved locally on every edit
 *   - x-lt-source from a lookup: the confirmation checklist's items come from
 *     the pinned `catalog/checks` edition, guarded by x-lt-require-all
 *
 * The role enforces its schema (`enforce_schema`), so a raw API resolve with
 * an option outside the pinned edition — or a stale cascade child — rejects
 * with the canonical 422.
 */

export const CASCADE_ROLE = 'catalog-picker';

export const CASCADE_SCHEMA_VERSION = 1;

/**
 * The payload shape the workflow receives from conditional after the human
 * completes the Catalog Pick form. Option membership (including the cascade
 * pair) has already been enforced against the pinned lookup editions.
 */
export interface CascadeResolverV1 {
  material: string;
  country: string;
  region: string;
  checks: Record<string, boolean>;
  notes?: string;
}

export const CASCADE_FORM_SCHEMA = {
  title: 'Catalog Pick',
  description: 'Pick a material and destination. Every option list comes from a version-pinned knowledge lookup.',
  'x-lt-order': [
    'material',
    'country',
    'region',
    'checks',
    'notes',
  ],
  'x-lt-help': [
    '### Catalog pick guide',
    '',
    'Every dropdown on this form offers a **version-pinned lookup** — the exact',
    'edition of the catalog this order was created against.',
    '',
    '**Material** options come from the pinned `catalog/materials` edition.',
    '',
    '**Region** follows your **Country** answer: it stays disabled until you',
    'choose a country, then offers only that country\'s regions.',
    '',
    '**Checklist** — every item must be checked before you can submit.',
  ].join('\n'),
  required: ['material', 'country', 'region', 'checks'],
  properties: {
    material: {
      type: 'string',
      title: 'Material',
      default: '',
      description: 'Material for this order',
      // Options ride the pinned catalog/materials edition.
      'x-lt-options': 'lookup.materials.items',
    },
    country: {
      type: 'string',
      title: 'Country',
      default: '',
      description: 'Destination country',
      'x-lt-options': 'lookup.geo.countries',
    },
    region: {
      type: 'string',
      title: 'Region',
      default: '',
      description: 'Region within the chosen country',
      // Cascade: options follow the live country answer.
      'x-lt-options': 'lookup.geo.regions.{{resolver.country}}',
    },
    checks: {
      type: 'object',
      default: {},
      description: 'Pre-submission checklist',
      'x-lt-widget': 'checklist',
      // Items ride the pinned catalog/checks edition.
      'x-lt-source': 'lookup.checks.items',
      'x-lt-require-all': true,
    },
    notes: {
      type: 'string',
      format: 'textarea',
      default: '',
      description: 'What was decided and why',
    },
  },
};
