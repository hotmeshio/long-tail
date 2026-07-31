/**
 * Auto-resolve demo — the reference for `x-lt-submit-guard.autoResolveWhenEmpty`.
 *
 * A parent "bag run" claimed to you embeds the list of items also claimed to you
 * (x-lt-widget: escalation-list, assigned: "me"). Each row's **Bagged ✓** action
 * resolves that item in place. The parent carries an x-lt-submit-guard on the
 * SAME query with `autoResolveWhenEmpty: true` and no fields of its own — a pure
 * container. Bag the items and the run closes ITSELF the moment the list drains:
 * no submit click.
 *
 * Seeded as bare, born-claimed escalations so it is clickable with no workflow
 * journey — open the run, bag the three items, watch it disappear.
 */
import { createRole, updateRoleMetadata } from '../services/role';
import { createEscalation, claimEscalation, listEscalations } from '../services/escalation';
import { getUserByExternalId } from '../services/user';
import { loggerRegistry } from '../lib/logger';

export const BAG_RUN_ROLE = 'bag-run';
export const BAG_ITEM_ROLE = 'bag-item';

const BATCH_ID = 'bag-demo';
const HOLD_MINUTES = 480; // a long claim so the demo stays put
const UNITS = ['ITEM-A', 'ITEM-B', 'ITEM-C'];

const BAG_ITEM_FORM_SCHEMA = {
  type: 'object',
  'x-lt-help': ['### Bag this item', '', 'Mark it bagged — or bag it inline from the run.'].join('\n'),
  'x-lt-order': ['bagged', 'notes'],
  properties: {
    bagged: { type: 'boolean', title: 'Bagged', default: true, description: 'This item is bagged and set aside' },
    notes: { type: 'string', format: 'textarea', title: 'Notes', default: '', maxLength: 200, description: 'Optional note' },
  },
};

const BAG_RUN_FORM_SCHEMA = {
  type: 'object',
  'x-lt-help': [
    '### Bag the run',
    '',
    'Every item claimed to you is listed below — **Bagged ✓** completes it in place.',
    'The run has no sign-off of its own: it closes ITSELF the moment the last item',
    'is bagged. No submit click.',
  ].join('\n'),
  // The precondition + the auto-close, both on the SAME query the embed renders.
  'x-lt-submit-guard': {
    query: { role: BAG_ITEM_ROLE, facets: { batchId: '{{metadata.batchId}}' }, assigned: 'me' },
    mustBeEmpty: true,
    message: '{{count}} item(s) still to bag — the run closes itself when the list is empty.',
    autoResolveWhenEmpty: true,
  },
  'x-lt-order': ['items', 'notes'],
  properties: {
    items: {
      type: 'string',
      readOnly: true,
      'x-lt-widget': 'escalation-list',
      'x-lt-query': { role: BAG_ITEM_ROLE, facets: { batchId: '{{metadata.batchId}}' }, assigned: 'me', limit: 20 },
      'x-lt-columns': [
        { label: 'Item', value: '{{metadata.unit}}' },
        { label: 'Age', value: '{{escalation.created_at}}', format: 'age' },
      ],
      'x-lt-actions': [
        { label: 'Bagged ✓', resolverPayload: { bagged: true }, confirm: 'Bag {{metadata.unit}}?' },
      ],
      'x-lt-span': 2,
      title: 'Items in this run',
      description: 'Claimed to you — bag each in place; the run auto-closes when the list is empty',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 200,
      'x-lt-span': 2,
      description: 'Optional closing note (the run does not require one)',
    },
  },
};

const DEMO_ROLES = [
  {
    role: BAG_ITEM_ROLE,
    title: 'Bag Item',
    description: 'One item in a bag run — resolved inline from the run via Bagged ✓, or on its own.',
    form_schema: BAG_ITEM_FORM_SCHEMA as Record<string, unknown>,
  },
  {
    role: BAG_RUN_ROLE,
    title: 'Bag Run',
    description: 'The auto-resolve reference: a pure-container parent that closes itself the moment its claimed items are all bagged (x-lt-submit-guard autoResolveWhenEmpty).',
    form_schema: BAG_RUN_FORM_SCHEMA as Record<string, unknown>,
  },
] as const;

export async function seedAutoResolveDemoRoles(): Promise<void> {
  for (const def of DEMO_ROLES) {
    try {
      await createRole(def.role);
    } catch { /* ON CONFLICT DO NOTHING */ }
    try {
      await updateRoleMetadata(def.role, {
        title: def.title,
        description: def.description,
        ops_visible: true,
        parent_role: null,
        sla_minutes: 30,
        target_per_hour: 10,
        priority_threshold_minutes: 30,
        form_schema: def.form_schema,
      });
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to configure ${def.role}: ${err.message}`);
    }
  }
}

export async function seedAutoResolveDemoEscalations(): Promise<void> {
  try {
    const { escalations: existing } = await listEscalations({ role: BAG_RUN_ROLE, status: 'pending', limit: 1 });
    if (existing.length > 0) {
      loggerRegistry.info('[examples] auto-resolve demo already seeded, skipping');
      return;
    }

    const user = await getUserByExternalId('superadmin');
    if (!user) {
      loggerRegistry.warn('[examples] auto-resolve demo: superadmin user not found, skipping');
      return;
    }

    const run = await createEscalation({
      type: 'bag',
      subtype: 'run',
      description: `Bag the run — ${UNITS.length} items`,
      priority: 2,
      role: BAG_RUN_ROLE,
      envelope: JSON.stringify({ source: 'auto-resolve-demo', formDefaults: { notes: '' } }),
      metadata: { batchId: BATCH_ID },
    });
    await claimEscalation(run.id, user.id, HOLD_MINUTES);

    for (const unit of UNITS) {
      const item = await createEscalation({
        type: 'bag',
        subtype: 'item',
        description: `Bag ${unit}`,
        priority: 3,
        role: BAG_ITEM_ROLE,
        envelope: JSON.stringify({ source: 'auto-resolve-demo', formDefaults: { bagged: true } }),
        metadata: { batchId: BATCH_ID, unit },
      });
      await claimEscalation(item.id, user.id, HOLD_MINUTES);
    }

    loggerRegistry.info(`[examples] auto-resolve demo seeded: 1 run + ${UNITS.length} items (claimed to superadmin)`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed auto-resolve demo: ${err.message}`);
  }
}
