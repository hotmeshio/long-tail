import { createRole, updateRoleMetadata, addEscalationChain } from '../services/role';
import { loggerRegistry } from '../lib/logger';

const ORTHO_ROLE_DATA = [
  { role: 'design', title: 'Design',  description: 'Create the orthotic design specification.',       parent_role: null,     sla_minutes: 30, target_per_hour: 8  },
  { role: 'review', title: 'Review',  description: 'Validate design against clinical requirements.',   parent_role: 'design', sla_minutes: 20, target_per_hour: 12 },
  { role: 'print',  title: 'Print',   description: 'Queue the design for 3D printing.',               parent_role: 'review', sla_minutes: 60, target_per_hour: 4  },
  { role: 'grid',   title: 'Grid',    description: 'Grid and align the printed substrate.',            parent_role: 'print',  sla_minutes: 20, target_per_hour: 10 },
  { role: 'glue',   title: 'Glue',    description: 'Bond the orthotic layers together.',              parent_role: 'grid',   sla_minutes: 15, target_per_hour: 15 },
  { role: 'finish', title: 'Finish',  description: 'Apply final finishing and edge smoothing.',       parent_role: 'glue',   sla_minutes: 20, target_per_hour: 12 },
  { role: 'qa',     title: 'QA',      description: 'Quality assurance check before shipment.',       parent_role: 'finish', sla_minutes: 15, target_per_hour: 16 },
  { role: 'ship',   title: 'Ship',    description: 'Package and dispatch the completed orthotic.',   parent_role: 'qa',     sla_minutes: 10, target_per_hour: 20 },
] as const;

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
