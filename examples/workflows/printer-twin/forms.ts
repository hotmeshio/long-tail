/**
 * Printer Twin forms — the JIT UI the twin presents to the print-servicer.
 * Each schema rides the escalation's `metadata.form_schema`, so the dashboard
 * renders the right form for the machine's current lifecycle moment.
 */

/**
 * Registration — the first escalation a fresh twin raises. The servicer plugs
 * the machine in, joins it to the farm manager, then records its identity here.
 * Submitting resolves the escalation and wakes the twin with this payload.
 */
export const REGISTRATION_FORM_SCHEMA = {
  title: 'Register Printer',
  description:
    'Unbox the machine, plug it in, and connect it to the print farm manager on the farm network. Then record the machine identity below — the digital twin captures it and begins advertising availability.',
  'x-lt-layout': 'two-column',
  'x-lt-order': [
    'serialNumber', 'model', 'manufactureDate', 'filament',
    'certifications', 'xl', 'pdac', 'soft', 'notes',
  ],
  required: ['serialNumber', 'model', 'manufactureDate', 'filament'],
  properties: {
    serialNumber: {
      type: 'string',
      default: '',
      description: 'Serial number printed on the machine chassis',
    },
    model: {
      type: 'string',
      default: '',
      description: 'Manufacturer model designation',
    },
    manufactureDate: {
      type: 'string',
      format: 'date',
      default: '',
      description: 'Manufacture date from the compliance label',
    },
    filament: {
      type: 'string',
      default: '',
      description: 'Filament currently loaded (e.g. pla, petg, tpu)',
    },
    certifications: {
      type: 'string',
      default: '',
      description: 'Certifications this machine carries, comma-separated',
    },
    xl: {
      type: 'boolean',
      default: false,
      description: 'Supports XL build volume',
    },
    pdac: {
      type: 'boolean',
      default: false,
      description: 'Certified for PDAC-billable devices',
    },
    soft: {
      type: 'boolean',
      default: false,
      description: 'Supports soft/flexible materials',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      default: '',
      description: 'Anything notable about this machine',
    },
  },
} as const;

/**
 * Service — raised when the machine's advert or in-flight print was cancelled
 * (power outage, mid-print failure, taken offline). The servicer physically
 * realigns the machine with its twin, then submits; the twin re-enters the pool.
 */
export const SERVICE_FORM_SCHEMA = {
  title: 'Service Printer',
  description:
    'This machine dropped out of alignment with its digital twin (cancelled advert or interrupted print). Inspect it, restore it on the farm manager, and record what was done. Submitting returns the machine to the available pool.',
  'x-lt-order': ['action', 'filamentLoaded', 'notes'],
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      default: '',
      description: 'What was done (e.g. power restored, filament reloaded, nozzle cleared)',
    },
    filamentLoaded: {
      type: 'string',
      default: '',
      description: 'Fill in only when the loaded filament changed',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      default: '',
      description: 'Service notes for the machine history',
    },
  },
} as const;
