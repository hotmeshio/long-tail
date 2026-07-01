import { createRole, updateRoleMetadata, addEscalationChain } from '../services/role';
import { loggerRegistry } from '../lib/logger';

const ORTHO_ROLE_DATA = [
  {
    role: 'design',
    title: 'Design',
    description: 'Create the orthotic design specification.',
    parent_role: null,
    sla_minutes: 30,
    target_per_hour: 8,
    form_schema: {
      properties: {
        spec_version: { type: 'string',  title: 'Spec Version', default: 'v1' },
        arch_type:    { type: 'string',  title: 'Arch Type', enum: ['standard', 'high', 'flat', 'custom'] },
        heel_mm:      { type: 'number',  title: 'Heel Height (mm)' },
        width_class:  { type: 'string',  title: 'Width Class', enum: ['narrow', 'standard', 'wide', 'extra-wide'] },
        notes:        { type: 'string',  title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['spec_version', 'arch_type'],
    },
  },
  {
    role: 'review',
    title: 'Review',
    description: 'Validate design against clinical requirements.',
    parent_role: 'design',
    sla_minutes: 20,
    target_per_hour: 12,
    form_schema: {
      properties: {
        approved:        { type: 'boolean', title: 'Approved' },
        revision_notes:  { type: 'string',  title: 'Revision Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['approved'],
    },
  },
  {
    role: 'print',
    title: 'Print',
    description: 'Queue the design for 3D printing.',
    parent_role: 'review',
    sla_minutes: 60,
    target_per_hour: 4,
    form_schema: {
      properties: {
        filament_type:   { type: 'string', title: 'Filament', enum: ['pla', 'tpu', 'petg', 'nylon'] },
        layer_height_mm: { type: 'number', title: 'Layer Height (mm)', default: 0.2 },
        print_time_min:  { type: 'number', title: 'Actual Print Time (min)' },
        notes:           { type: 'string', title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['filament_type'],
    },
  },
  {
    role: 'grind',
    title: 'Grind',
    description: 'Grind and align the printed substrate.',
    parent_role: 'print',
    sla_minutes: 20,
    target_per_hour: 10,
    form_schema: {
      properties: {
        alignment_ok: { type: 'boolean', title: 'Alignment Verified' },
        offset_mm:    { type: 'number',  title: 'Offset Correction (mm)', default: 0 },
        notes:        { type: 'string',  title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['alignment_ok'],
    },
  },
  {
    role: 'glue',
    title: 'Glue',
    description: 'Bond the orthotic layers together.',
    parent_role: 'grind',
    sla_minutes: 15,
    target_per_hour: 15,
    form_schema: {
      properties: {
        adhesive_type:  { type: 'string',  title: 'Adhesive', enum: ['contact', 'heat-activated', 'solvent'] },
        bond_verified:  { type: 'boolean', title: 'Bond Strength Verified' },
        cure_time_min:  { type: 'number',  title: 'Cure Time (min)' },
        notes:          { type: 'string',  title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['adhesive_type', 'bond_verified'],
    },
  },
  {
    role: 'finish',
    title: 'Finish',
    description: 'Apply final finishing and edge smoothing.',
    parent_role: 'glue',
    sla_minutes: 20,
    target_per_hour: 12,
    form_schema: {
      properties: {
        surface_quality: { type: 'string',  title: 'Surface Quality', enum: ['good', 'acceptable', 'rework'] },
        edge_condition:  { type: 'string',  title: 'Edge Condition', enum: ['smooth', 'minor-burr', 'rework'] },
        notes:           { type: 'string',  title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['surface_quality', 'edge_condition'],
    },
  },
  {
    role: 'qa',
    title: 'QA',
    description: 'Quality assurance check before shipment.',
    parent_role: 'finish',
    sla_minutes: 15,
    target_per_hour: 16,
    form_schema: {
      properties: {
        passed:        { type: 'boolean', title: 'QA Passed' },
        defect_count:  { type: 'number',  title: 'Defects Found', default: 0 },
        defect_notes:  { type: 'string',  title: 'Defect Details', 'x-lt-widget': 'textarea' },
      },
      required: ['passed'],
    },
  },
  {
    role: 'ship',
    title: 'Ship',
    description: 'Package and dispatch the completed orthotic.',
    parent_role: 'qa',
    sla_minutes: 10,
    target_per_hour: 20,
    form_schema: {
      properties: {
        carrier:          { type: 'string', title: 'Carrier', enum: ['fedex', 'ups', 'usps', 'dhl', 'local'] },
        tracking_number:  { type: 'string', title: 'Tracking Number' },
        notes:            { type: 'string', title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['carrier', 'tracking_number'],
    },
  },
];

export async function seedOrthoRoles(): Promise<void> {
  for (const data of ORTHO_ROLE_DATA) {
    try {
      await createRole(data.role);
    } catch { /* ON CONFLICT DO NOTHING */ }
    try {
      await updateRoleMetadata(data.role, {
        title: data.title,
        description: data.description,
        ops_visible: true,
        parent_role: data.parent_role ?? null,
        sla_minutes: data.sla_minutes,
        target_per_hour: data.target_per_hour,
        form_schema: data.form_schema,
      });
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update ortho role ${data.role}: ${err.message}`);
    }
  }

  const stages = ORTHO_ROLE_DATA.map((d) => d.role);
  for (let i = 0; i < stages.length - 1; i++) {
    try {
      await addEscalationChain(stages[i], stages[i + 1]);
    } catch { /* ON CONFLICT DO NOTHING */ }
  }

  loggerRegistry.info(`[examples] ortho roles verified (${stages.join(' → ')})`);
}
