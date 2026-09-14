/**
 * Fleet tools — the invoke-form reference.
 *
 * One workflow, four tools, one form. The `action` decision gates everything
 * beneath it: each tool reveals only its own knobs and its own instruction
 * block, so the operator never sees a field that does not apply. The same
 * x-lt-* vocabulary the escalation forms use drives the invoke surface:
 * two-column layout, sections, column groups, conditional display,
 * pattern messages, and a help panel that reads the live values. The serial
 * select reads a versioned knowledge edition pinned on the worker config
 * (`lookup.serials.items`); the filament and its color cascade through a
 * pinned material catalog; the label select carries inline labeled options;
 * the priority is a clearable select; the power-cycle decision is a Yes/No
 * select over a boolean; the slots are a multi-select list; the readings are
 * a validated JSON map; the removed parts are a JSON list checked per item.
 *
 * The payload the workflow receives is the x-lt-bind shape, not the flat
 * form: `printer.serialNumber`, `tool.action`, `tool.details.*`.
 */

/** The knowledge edition the serial select reads. */
export const FLEET_SERIALS_LOOKUP = { domain: 'fleet', key: 'serial-numbers', version: 1, as: 'serials' } as const;
/** The material catalog: `items` for the filament select, `colors.<material>` for the cascade. */
export const FLEET_MATERIALS_LOOKUP = { domain: 'fleet', key: 'materials', version: 1, as: 'materials' } as const;
export const FLEET_PRIORITIES = [{ value: 'rush', label: 'Rush' }, { value: 'batch', label: 'With the next batch' }] as const;
export const FLEET_REMOVABLE_PARTS = ['label', 'network-drop', 'spool-holder', 'build-plate'] as const;
export const FLEET_SPOOL_SLOTS = ['slot-1', 'slot-2', 'slot-3', 'slot-4'] as const;
export const FLEET_READINGS = ['temperature', 'humidity', 'voltage'] as const;

export const FLEET_TOOL_ACTIONS = {
  REPRINT_LABEL: 'reprint-label',
  CHANGE_FILAMENT: 'change-filament',
  REPORT_OFFLINE: 'report-offline',
  RETIRE: 'retire',
} as const;
export type FleetToolAction = (typeof FLEET_TOOL_ACTIONS)[keyof typeof FLEET_TOOL_ACTIONS];

const SECTION_TOOL = 'The tool';
const SECTION_LABEL = 'Reprint the label';
const SECTION_FILAMENT = 'Change the filament';
const SECTION_OFFLINE = 'Report the machine offline';
const SECTION_RETIRE = 'Retire the machine';

const showFor = (action: FleetToolAction) => `input.action=${action}`;

/** A read-only markdown block: the instruction that belongs to one tool. */
const instruction = (action: FleetToolAction, section: string, markdown: string) => ({
  type: 'string',
  'x-lt-widget': 'markdown',
  readOnly: true,
  default: markdown,
  'x-lt-section': section,
  'x-lt-span': 2,
  'x-lt-showIf': showFor(action),
});

export const FLEET_TOOLS_INPUT_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-help': [
    '## Fleet tools',
    '',
    'Working on **{{input.serialNumber}}** · tool **{{input.action}}**',
    '',
    '| Tool | When | Does |',
    '|---|---|---|',
    '| reprint-label | The bag label is missing or unreadable | Prints the bag, plate, or spool label again (1–5 copies), rush or with the batch |',
    '| change-filament | The spool ran out or the material is wrong | Records the material, its color, and the slots reloaded |',
    '| report-offline | The machine stopped answering | Parks the twin and alerts service; asks for a power cycle first |',
    '| retire | The machine leaves the fleet for good | Cancels the twin and releases the serial |',
    '',
    'Pick the tool first. Each tool brings its own instructions into the form.',
    '',
    'The serial and filament lists are versioned catalog editions pinned on the workflow; the color list follows the material you pick.',
  ].join('\n'),
  'x-lt-order': [
    'serialNumber', 'action',
    'copies', 'labelKind', 'priority', 'reprintInstructions',
    'filamentType', 'filamentColor', 'slots', 'filamentInstructions',
    'lastSeenAt', 'powerCycled', 'readings', 'offlineInstructions', 'powerCycleFirst',
    'reason', 'confirm', 'removedParts', 'retireInstructions',
  ],
  required: ['serialNumber', 'action', 'copies', 'labelKind', 'filamentType', 'filamentColor', 'slots', 'lastSeenAt', 'powerCycled', 'reason', 'confirm'],
  properties: {
    serialNumber: {
      type: 'string',
      title: 'Serial number',
      description: 'Pick the machine; the list is the pinned edition of what the fleet has seen',
      'x-lt-options': `lookup.${FLEET_SERIALS_LOOKUP.as}.items`,
      pattern: '^[A-Za-z0-9-]{4,}$',
      'x-lt-pattern-error': 'Letters, digits, and dashes only',
      'x-lt-bind': 'printer.serialNumber',
      'x-lt-section': SECTION_TOOL,
    },
    action: {
      type: 'string',
      title: 'Tool',
      description: 'Pick the tool to run on this machine',
      enum: Object.values(FLEET_TOOL_ACTIONS),
      'x-lt-bind': 'tool.action',
      'x-lt-section': SECTION_TOOL,
    },

    copies: {
      type: 'number',
      title: 'Copies',
      description: 'Print between one and five labels',
      minimum: 1,
      maximum: 5,
      default: 1,
      'x-lt-column-group': 'label',
      'x-lt-bind': 'tool.details.copies',
      'x-lt-section': SECTION_LABEL,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.REPRINT_LABEL),
    },
    labelKind: {
      type: 'string',
      title: 'Label',
      description: 'Choose which label the machine needs',
      'x-lt-options': [
        { value: 'bag', label: 'Bag label' },
        { value: 'plate', label: 'Plate label' },
        { value: 'spool', label: 'Spool label' },
      ],
      'x-lt-column-group': 'label',
      'x-lt-bind': 'tool.details.labelKind',
      'x-lt-section': SECTION_LABEL,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.REPRINT_LABEL),
    },
    priority: {
      type: 'string',
      title: 'Priority',
      description: 'Leave unset to print with the queue',
      'x-lt-options': [...FLEET_PRIORITIES],
      'x-lt-nullable': true,
      'x-lt-bind': 'tool.details.priority',
      'x-lt-section': SECTION_LABEL,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.REPRINT_LABEL),
    },
    reprintInstructions: instruction(
      FLEET_TOOL_ACTIONS.REPRINT_LABEL,
      SECTION_LABEL,
      '**Reprint** sends the same sticker the harvest walk minted. Peel the old label before applying the new one.',
    ),

    filamentType: {
      type: 'string',
      title: 'Filament',
      description: 'Choose the material now loaded; the list is the pinned catalog edition',
      'x-lt-options': `lookup.${FLEET_MATERIALS_LOOKUP.as}.items`,
      'x-lt-column-group': 'filament',
      'x-lt-bind': 'tool.details.filamentType',
      'x-lt-section': SECTION_FILAMENT,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.CHANGE_FILAMENT),
    },
    filamentColor: {
      type: 'string',
      title: 'Color',
      description: 'The colors the catalog lists for that material',
      'x-lt-options': `lookup.${FLEET_MATERIALS_LOOKUP.as}.colors.{{input.filamentType}}`,
      'x-lt-column-group': 'filament',
      'x-lt-bind': 'tool.details.filamentColor',
      'x-lt-section': SECTION_FILAMENT,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.CHANGE_FILAMENT),
    },
    slots: {
      type: 'array',
      title: 'Slots reloaded',
      description: 'Pick every slot you changed',
      items: { type: 'string' },
      'x-lt-options': FLEET_SPOOL_SLOTS.map((slot) => ({ value: slot, label: slot.replace('slot-', 'Slot ') })),
      minItems: 1,
      'x-lt-span': 2,
      'x-lt-bind': 'tool.details.slots',
      'x-lt-section': SECTION_FILAMENT,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.CHANGE_FILAMENT),
    },
    filamentInstructions: instruction(
      FLEET_TOOL_ACTIONS.CHANGE_FILAMENT,
      SECTION_FILAMENT,
      'Purge the nozzle after the swap. Record the material so the next print slices for it.',
    ),

    lastSeenAt: {
      type: 'string',
      format: 'date-time',
      title: 'Last seen',
      description: 'When the machine last answered',
      'x-lt-column-group': 'offline',
      'x-lt-bind': 'tool.details.lastSeenAt',
      'x-lt-section': SECTION_OFFLINE,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.REPORT_OFFLINE),
    },
    powerCycled: {
      type: 'boolean',
      title: 'Power cycled',
      description: 'Did you switch the machine off and on?',
      'x-lt-options': [{ value: true, label: 'Yes' }, { value: false, label: 'No' }],
      'x-lt-column-group': 'offline',
      'x-lt-bind': 'tool.details.powerCycled',
      'x-lt-section': SECTION_OFFLINE,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.REPORT_OFFLINE),
    },
    readings: {
      type: 'object',
      title: 'Last readings',
      description: 'Optional; the last values the machine reported, keyed by sensor',
      'x-lt-widget': 'json',
      propertyNames: { enum: [...FLEET_READINGS] },
      additionalProperties: { type: 'number', minimum: 0 },
      'x-lt-span': 2,
      'x-lt-bind': 'tool.details.readings',
      'x-lt-section': SECTION_OFFLINE,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.REPORT_OFFLINE),
    },
    offlineInstructions: instruction(
      FLEET_TOOL_ACTIONS.REPORT_OFFLINE,
      SECTION_OFFLINE,
      'Reporting a machine offline parks its twin and alerts the service queue.',
    ),
    powerCycleFirst: {
      ...instruction(
        FLEET_TOOL_ACTIONS.REPORT_OFFLINE,
        SECTION_OFFLINE,
        '**Power cycle first.** Most stalls clear on a restart. Answer Yes once you have tried it.',
      ),
      'x-lt-showIf': [showFor(FLEET_TOOL_ACTIONS.REPORT_OFFLINE), '!input.powerCycled'],
    },

    reason: {
      type: 'string',
      title: 'Reason',
      description: 'Say why the machine leaves the fleet',
      enum: ['end-of-life', 'unrepairable', 'sold'],
      'x-lt-bind': 'tool.details.reason',
      'x-lt-section': SECTION_RETIRE,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.RETIRE),
    },
    confirm: {
      type: 'boolean',
      title: 'Confirm retirement',
      description: 'Tick to confirm; the twin is cancelled and the serial is released',
      default: false,
      'x-lt-bind': 'tool.details.confirm',
      'x-lt-section': SECTION_RETIRE,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.RETIRE),
    },
    removedParts: {
      type: 'array',
      title: 'Parts removed',
      description: 'Optional; a JSON list of the parts taken off before hand-over',
      'x-lt-widget': 'json',
      items: { type: 'string', enum: [...FLEET_REMOVABLE_PARTS] },
      maxItems: FLEET_REMOVABLE_PARTS.length,
      'x-lt-span': 2,
      'x-lt-bind': 'tool.details.removedParts',
      'x-lt-section': SECTION_RETIRE,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.RETIRE),
    },
    retireInstructions: instruction(
      FLEET_TOOL_ACTIONS.RETIRE,
      SECTION_RETIRE,
      'Retiring is permanent. Remove the label and the network drop before you submit.',
    ),
  },
};

/** The envelope metadata the invoke form stamps on every run. */
export const FLEET_TOOLS_ENVELOPE_METADATA = { source: 'dashboard' };

/** The nested payload the workflow receives once x-lt-bind has mapped the form. */
export interface FleetToolsInput {
  printer: { serialNumber: string };
  tool: {
    action: FleetToolAction;
    details?: Record<string, unknown>;
  };
}
