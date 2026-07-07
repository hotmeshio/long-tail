import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

const ORTHO_ROLE_DATA = [
  {
    role: 'design',
    title: 'Design',
    description: 'Create the orthotic design specification.',
    parent_role: null,
    sla_minutes: 3,
    target_per_hour: 22,
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
    sla_minutes: 3,
    target_per_hour: 22,
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
    sla_minutes: 4,
    target_per_hour: 22,
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
    sla_minutes: 3,
    target_per_hour: 22,
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
    sla_minutes: 3,
    target_per_hour: 22,
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
    sla_minutes: 3,
    target_per_hour: 22,
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
    sla_minutes: 2,
    target_per_hour: 22,
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
    sla_minutes: 2,
    target_per_hour: 22,
    // Ship draws finished inserts from the shoe side-quest — a cross-sequence
    // merge, rendered as the merge glyph on the Pace Board, not a bend in
    // the main line.
    upstream_roles: ['inserting'],
    form_schema: {
      properties: {
        carrier:          { type: 'string', title: 'Carrier', enum: ['fedex', 'ups', 'usps', 'dhl', 'local'] },
        tracking_number:  { type: 'string', title: 'Tracking Number' },
        notes:            { type: 'string', title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['carrier', 'tracking_number'],
    },
  },
  // ── Shoe side-quest (its own sequence: ordering → inserting ⇒ ship) ──────
  {
    role: 'ordering',
    title: 'Ordering',
    description: 'Order the patient’s shoes from the vendor.',
    parent_role: null,
    sla_minutes: 3,
    target_per_hour: 22,
    form_schema: {
      properties: {
        po_number: { type: 'string', title: 'PO Number' },
        notes:     { type: 'string', title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['po_number'],
    },
  },
  {
    role: 'inserting',
    title: 'Inserting',
    description: 'Fit the finished inserts into the delivered shoes.',
    parent_role: 'ordering',
    sla_minutes: 5,
    target_per_hour: 22,
    form_schema: {
      properties: {
        inserted: { type: 'boolean', title: 'Inserts Fitted' },
        notes:    { type: 'string',  title: 'Notes', 'x-lt-widget': 'textarea' },
      },
      required: ['inserted'],
    },
  },
];

export async function seedOrthoRoles(): Promise<void> {
  // Earlier boot steps (worker-config registration, escalation-chain ensures)
  // create bare role rows before this seeder runs, so "did createRole insert"
  // alone under-detects a fresh install. A role is seedable when this call
  // created it OR when it exists untitled and schema-less; a role the admin
  // has configured keeps its titles, SLAs, and schemas across restarts.
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  // 1. Ensure every bare role row exists before any metadata is applied —
  //    parent_role and upstream_roles reference lt_roles, and ship points at
  //    the side-quest's `inserting` across the array order.
  const createdRoles = new Set<string>();
  for (const data of ORTHO_ROLE_DATA) {
    try {
      if (await createRole(data.role)) createdRoles.add(data.role);
    } catch { /* ON CONFLICT DO NOTHING */ }
  }

  // 2. Apply titles, dials, sequence edges, and form schemas.
  for (const data of ORTHO_ROLE_DATA) {
    const created = createdRoles.has(data.role);
    const row = existing.get(data.role);
    const unconfigured = row != null && row.title == null && row.form_schema == null;
    if (created || unconfigured) {
      try {
        await updateRoleMetadata(data.role, {
          title: data.title,
          description: data.description,
          ops_visible: true,
          parent_role: data.parent_role ?? null,
          sla_minutes: data.sla_minutes,
          target_per_hour: data.target_per_hour,
          form_schema: data.form_schema,
          ...('upstream_roles' in data
            ? { upstream_roles: (data as { upstream_roles: string[] }).upstream_roles }
            : {}),
        });
      } catch (err: any) {
        loggerRegistry.warn(`[examples] failed to update ortho role ${data.role}: ${err.message}`);
      }
    }
  }

  // The process sequence lives entirely in parent_role + ops_visible — that
  // pair is what the Operations view renders as the station graph. Escalation
  // chains are a separate runtime RBAC construct (which roles an operator may
  // escalate an item TO, e.g. associate → manager) and stay admin-owned;
  // seeding stage→stage chains here would encode the pipeline into the
  // permission system.
  const stages = ORTHO_ROLE_DATA.map((d) => d.role);
  loggerRegistry.info(`[examples] ortho roles verified (${stages.join(' → ')})`);
}
