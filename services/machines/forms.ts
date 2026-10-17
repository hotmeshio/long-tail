/**
 * The escalation surfaces each role owns. A handoff row looks the same to a
 * machine and to a person: machines resolve it through the gateway, a person
 * resolves the line-exit row with this form. Line operators decide failed
 * handoffs and close alarm and machine-state rows.
 */

import { DECISION } from './contracts';

export const HANDOFF_FORM_SCHEMA = {
  title: 'Receive units',
  description: 'Confirm the units are in hand. A machine confirms its own receipts; this form is for a person receiving them.',
  'x-lt-order': ['received', 'receiver', 'note'],
  required: ['received'],
  properties: {
    received: { type: 'boolean', default: true, description: 'Every unit in this handoff is in hand' },
    receiver: { type: 'string', default: '', description: 'Who or what received them' },
    note: { type: 'string', format: 'textarea', default: '', description: 'Anything notable about the units' },
  },
};

export const OPERATOR_FORM_SCHEMA = {
  title: 'Line decision',
  description:
    'A handoff that did not complete: retry it, finish the units by hand, or scrap them. An alarm or a machine that went dark: acknowledge it once handled.',
  'x-lt-order': ['decision', 'note'],
  required: ['decision'],
  properties: {
    decision: {
      type: 'string',
      enum: Object.values(DECISION),
      default: DECISION.ACKNOWLEDGE,
      description: 'retry · manual · scrap for a failed handoff; acknowledge for an alarm or a machine',
    },
    note: { type: 'string', format: 'textarea', default: '', description: 'What was done' },
    clearedBy: { type: 'string', default: '', description: 'Who cleared it at the machine, when the machine reports it' },
  },
};
