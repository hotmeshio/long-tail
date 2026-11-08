import { seedLabelTemplate } from '../services/labels';
import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';
import type { LabelTemplateInput } from '../types/labels';
import { RELABELER_FORM_SCHEMA, RELABELER_ROLE } from './workflows/relabel/forms';

/**
 * Label templates for the example scan schemes, one per printable thing:
 *
 * - printer-corners (scheme 10): one label per printer with all four corner
 *   acts, each code beside the act it names. Solid and outline bands tell
 *   neighbouring acts apart on black-only stock.
 * - associate-badge (scheme 11): an ID card per associate, the QR code a
 *   printed credential. Identity templates are always sensitive.
 * - bag-label (scheme 12) and bin-label (scheme 13): the bench motion's two
 *   stickers. Each prints its target as the heading and {item.subtitle} as
 *   the second line, from a row's facet or a list column.
 */
export const EXAMPLE_LABEL_TEMPLATES: LabelTemplateInput[] = [
  {
    name: 'printer-corners',
    scheme_version: 10,
    title: 'Printer corner codes',
    description: 'Every act on a printer, one code per act.',
    codes: [
      { category: '0', tone: 'solid' },
      { category: '1', tone: 'outline' },
      { category: '2', tone: 'solid' },
      { category: '3', tone: 'outline' },
    ],
    text: { title: '{target}', lines: ['{item.printerModel}'] },
    media: 'a4-l7165',
  },
  {
    name: 'associate-badge',
    scheme_version: 11,
    title: 'Associate badge',
    description: 'An ID card that primes a station as its holder.',
    codes: [{ category: '0', caption: '', tone: 'plain' }],
    text: { title: '{user.display_name}', lines: ['{user.roles}'] },
    symbology: 'qrcode',
    human_readable: false,
    media: 'a4-cr80',
  },
  {
    name: 'bag-label',
    scheme_version: 12,
    title: 'Bag label',
    codes: [{ category: '0', tone: 'solid' }],
    text: { title: '{target}', lines: ['{item.subtitle}'] },
    media: 'a4-l7160',
  },
  {
    name: 'bin-label',
    scheme_version: 13,
    title: 'Bin label',
    codes: [{ category: '0', tone: 'solid' }],
    text: { title: '{target}', lines: ['{item.subtitle}'] },
    media: 'a4-l7160',
  },
];

export async function seedLabelTemplates(): Promise<void> {
  for (const template of EXAMPLE_LABEL_TEMPLATES) {
    try {
      if (await seedLabelTemplate(template)) loggerRegistry.info(`[examples] label template seeded: ${template.name}`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to seed label template ${template.name}: ${err.message}`);
    }
  }
}

/** The relabeler role: the form that asks for a label's second line (relabel). */
export async function seedRelabelerRole(): Promise<void> {
  const existing = (await listRolesWithDetails()).find((r) => r.role === RELABELER_ROLE);
  let created = false;
  try {
    created = await createRole(RELABELER_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }
  if (!created && existing?.title != null) return;
  try {
    await updateRoleMetadata(RELABELER_ROLE, {
      title: 'Relabeler',
      description: 'Supplies the text a label is missing; each answer reprints the label.',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 30,
      target_per_hour: 20,
      form_schema: RELABELER_FORM_SCHEMA,
    });
    loggerRegistry.info(`[examples] relabeler role verified (${RELABELER_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update relabeler role: ${err.message}`);
  }
}
