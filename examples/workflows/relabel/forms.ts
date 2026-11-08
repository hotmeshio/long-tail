/**
 * The relabeler's form: the second line a target's label carries. The role
 * owns the form; the workflow only names the target and template.
 */
export const RELABELER_ROLE = 'relabeler';
export const RELABELER_SCHEMA_VERSION = 1;

export interface RelabelV1 {
  subtitle: string;
}

export const RELABELER_FORM_SCHEMA = {
  title: 'Relabel',
  description: 'Enter the second line for this label. The label reprints with it.',
  required: ['subtitle'],
  properties: {
    subtitle: { type: 'string', title: 'Second line', description: 'Printed under the label heading.' },
  },
};
