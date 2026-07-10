/**
 * Printer Twin role schemas — the escalation surface each human role owns.
 *
 * These are NOT declared on the workflow or inline on the escalation. They are
 * the versioned `form_schema` of the escalation TARGET ROLES (declared on the
 * role in seed-twin.ts, exactly like each ortho stage role owns its form). The
 * twin raises escalations to a role; the dashboard renders that role's schema.
 *
 *   print-onboarder → REGISTRATION_FORM_SCHEMA (onboard a new machine)
 *   print-servicer  → SERVICE_FORM_SCHEMA     (service an existing machine)
 */

/**
 * The onboarding surface: a servicer plugs a new machine in, joins it to the
 * farm manager, and records its identity. Resolving wakes the twin, which binds
 * the machine and begins advertising.
 */
export const REGISTRATION_FORM_SCHEMA = {
  title: 'Register Printer',
  description:
    'Unbox the machine, plug it in, and connect it to the print farm manager on the farm network. Then record the machine identity below — the digital twin captures it, binds the machine, and begins advertising availability.',
  'x-lt-layout': 'two-column',
  'x-lt-order': [
    'serialNumber', 'model', 'manufactureDate', 'filament',
    'certifications', 'xl', 'pdac', 'soft', 'notes',
  ],
  required: ['serialNumber', 'model', 'manufactureDate', 'filament'],
  properties: {
    serialNumber: { type: 'string', default: '', description: 'Serial number printed on the machine chassis' },
    model: { type: 'string', default: '', description: 'Manufacturer model designation' },
    manufactureDate: { type: 'string', format: 'date', default: '', description: 'Manufacture date from the compliance label' },
    filament: { type: 'string', default: '', description: 'Filament currently loaded (e.g. pla, petg, tpu)' },
    certifications: { type: 'string', default: '', description: 'Certifications this machine carries, comma-separated' },
    xl: { type: 'boolean', default: false, description: 'Supports XL build volume' },
    pdac: { type: 'boolean', default: false, description: 'Certified for PDAC-billable devices' },
    soft: { type: 'boolean', default: false, description: 'Supports soft/flexible materials' },
    notes: { type: 'string', format: 'textarea', default: '', description: 'Anything notable about this machine' },
  },
};

/**
 * The servicing surface: one rich form covering every service decision the twin
 * asks for — reload filament after a runout, inspect a failed print (reset or
 * decommission), or confirm an offline machine is back. The twin reads the field
 * relevant to the escalation it raised; the servicer fills what applies.
 */
export const SERVICE_FORM_SCHEMA = {
  title: 'Service Printer',
  description:
    'This machine needs attention — it may have run out of filament, failed a print, or dropped offline. Do the physical work, then record what was done. Submitting realigns the machine with its digital twin and returns it to the pool.',
  'x-lt-order': ['action', 'filamentLoaded', 'notes'],
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['added-filament', 'reset', 'decommission', 'reconnected', 'restored'],
      default: 'restored',
      description:
        'added-filament = reloaded a spool; reset = cleared a fault and returned to the pool; decommission = retire the machine; reconnected = brought a dark machine back; restored = general fix',
    },
    filamentLoaded: {
      type: 'string',
      default: '',
      description: 'Fill in only when a spool was loaded — the filament now on the machine (changing it changes the machine’s capability)',
    },
    notes: { type: 'string', format: 'textarea', default: '', description: 'Service notes for the machine history' },
  },
};
