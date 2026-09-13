/**
 * Fleet tools — the invoke-form reference.
 *
 * One workflow, four tools, one form. The `action` decision gates everything
 * beneath it: each tool reveals only its own knobs and its own instruction
 * block, so the operator never sees a field that does not apply. The same
 * x-lt-* vocabulary the escalation forms use drives the invoke surface:
 * two-column layout, sections, column groups, conditional display,
 * pattern messages, and a help panel that reads the live values.
 *
 * The payload the workflow receives is the x-lt-bind shape, not the flat
 * form: `printer.serialNumber`, `tool.action`, `tool.details.*`.
 */

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
    '| Tool | When |',
    '|---|---|',
    '| reprint-label | The bag label is missing or unreadable |',
    '| change-filament | The spool ran out or the material is wrong |',
    '| report-offline | The machine stopped answering |',
    '| retire | The machine leaves the fleet for good |',
    '',
    'Pick the tool first. The form shows only that tool\'s knobs.',
  ].join('\n'),
  'x-lt-order': [
    'serialNumber', 'action',
    'copies', 'labelKind', 'reprintInstructions',
    'filamentType', 'spoolCount', 'filamentInstructions',
    'lastSeenAt', 'powerCycled', 'offlineInstructions', 'powerCycleFirst',
    'reason', 'confirm', 'retireInstructions',
  ],
  required: ['serialNumber', 'action', 'copies', 'labelKind', 'filamentType', 'spoolCount', 'lastSeenAt', 'reason', 'confirm'],
  properties: {
    serialNumber: {
      type: 'string',
      title: 'Serial number',
      description: 'Read it off the machine label',
      pattern: '^[a-z0-9-]{4,}$',
      'x-lt-pattern-error': 'Lowercase letters, digits, and dashes only',
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
      enum: ['bag', 'plate', 'spool'],
      'x-lt-column-group': 'label',
      'x-lt-bind': 'tool.details.labelKind',
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
      description: 'Choose the material now loaded',
      enum: ['PLA', 'PETG', 'TPU'],
      'x-lt-column-group': 'filament',
      'x-lt-bind': 'tool.details.filamentType',
      'x-lt-section': SECTION_FILAMENT,
      'x-lt-showIf': showFor(FLEET_TOOL_ACTIONS.CHANGE_FILAMENT),
    },
    spoolCount: {
      type: 'number',
      title: 'Spools loaded',
      description: 'Count the spools on the machine',
      minimum: 1,
      maximum: 4,
      default: 1,
      'x-lt-column-group': 'filament',
      'x-lt-bind': 'tool.details.spoolCount',
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
      description: 'Confirm you switched the machine off and on',
      default: false,
      'x-lt-column-group': 'offline',
      'x-lt-bind': 'tool.details.powerCycled',
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
        '**Power cycle first.** Most stalls clear on a restart. Tick the box once you have tried it.',
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
