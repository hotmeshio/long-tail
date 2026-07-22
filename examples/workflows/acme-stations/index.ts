/**
 * Acme Widget — the reference two-station fabrication flow behind the
 * "perfect form" pair. One widget walks Addons → Final QA; each station is
 * a role-owned, versioned escalation form (see forms.ts for the form doctrine).
 *
 * The workflow builds each station's envelope from the work item:
 *   - `checklist_items` — the station's standard confirmations. At Addons they
 *     arrive PRE-CHECKED through formDefaults: the standard is the default,
 *     the resolver unchecks what isn't true.
 *   - `custom_items` — the widget's own addon work, named item by item,
 *     unchecked: those are the clicks that matter.
 *   - `reject_reason_items` + `maxRejectLeft/Right` — the report vocabulary
 *     and the caps the form validates against.
 *   - `formDefaults` — reverse-mapped through each form's x-lt-bind so the
 *     facts dictionary renders the widget and the decision opens on "Choose…".
 *
 * A rejection at either station ends the run with the report; QA Pass
 * completes the widget.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import {
  ACME_ADDONS_ROLE,
  ACME_ADDONS_SCHEMA_VERSION,
  ACME_QA_ROLE,
  ACME_QA_SCHEMA_VERSION,
  type AcmeAddonsResolverV1,
  type AcmeChecklistItem,
  type AcmeQaResolverV1,
} from './forms';

type ActivitiesType = typeof activities;

export interface AcmeWidgetEnvelopeData {
  po?: string;
  widgetId?: string;
  leftQuantity?: number;
  rightQuantity?: number;
  widgetType?: string;
  sizeCode?: string;
  material?: string;
  certified?: boolean;
  /** The widget's addon work — each becomes a clickable custom-work item. */
  addons?: Array<{ id: string; label: string }>;
}

const ADDONS_FIXED_ITEMS: AcmeChecklistItem[] = [
  { id: 'attached', label: 'Every addon attached per the spec' },
  { id: 'alignment', label: 'Fit and alignment verified against the spec (position, tolerances)' },
];

const QA_FIXED_ITEMS: AcmeChecklistItem[] = [
  { id: 'counts', label: 'Counts match the spec — physical widgets vs the left/right quantities' },
  { id: 'burrs', label: 'No burrs or rough edges — sweep each widget, top and bottom' },
  { id: 'seams', label: 'No seam separation — flex each widget gently' },
  { id: 'flat', label: 'Sits flat — no warping on the table' },
];

const REJECT_REASON_ITEMS: AcmeChecklistItem[] = [
  { id: 'burrs', label: 'Burrs or rough edges' },
  { id: 'separation', label: 'Seam separation' },
  { id: 'warping', label: 'Warping' },
  { id: 'fill', label: 'Incomplete fill' },
  { id: 'material', label: 'Wrong material' },
  { id: 'damage', label: 'Handling damage' },
];

export async function acmeWidget(envelope: LTEnvelope): Promise<any> {
  const {
    po = 'ACME-1042',
    widgetId = 'wgt-8127',
    leftQuantity = 1,
    rightQuantity = 1,
    widgetType = 'Standard',
    sizeCode = 'S2',
    material = 'alloy',
    certified = false,
    addons = [
      { id: 'mount_front', label: 'Mount — front, left — verified on the widget' },
      { id: 'gasket_std', label: 'Gasket — standard — verified on the widget' },
    ],
  } = (envelope.data ?? {}) as AcmeWidgetEnvelopeData;

  const { processAddons, processQa } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
  });

  const ctx = Durable.workflow.workflowInfo();

  // The facts ride both surfaces: metadata (searchable facets) and
  // formDefaults (the form's dictionary rows).
  const facts = {
    po,
    widgetId,
    leftQuantity: String(leftQuantity),
    rightQuantity: String(rightQuantity),
    widgetType,
    sizeCode,
    material,
    certified: certified ? 'true' : 'false',
  };

  // ── Station 1: Addons ──────────────────────────────────────────────────────
  // The standard confirmations arrive pre-checked; the widget's own addon work
  // arrives unchecked — the resolver's clicks are the record.
  // Typed loosely: `outcome: ''` is the deliberate unchosen state the form
  // opens on ("Choose…"), which the resolver contract itself never carries.
  const addonsDefaults: Record<string, unknown> = {
    ...facts,
    outcome: '',
    checks: Object.fromEntries(ADDONS_FIXED_ITEMS.map((item) => [item.id, true])),
    customChecks: Object.fromEntries(addons.map((item) => [item.id, false])),
  };

  const addonsResult = await conditionLT<AcmeAddonsResolverV1>(`acme-addons-${ctx.workflowId}`, {
    role: ACME_ADDONS_ROLE,
    type: 'station',
    subtype: 'addons',
    priority: 2,
    description: `Addons — ${po} · ${widgetId}`,
    workflowType: 'acmeWidget',
    envelope: {
      source: 'acme-widget',
      formDefaults: addonsDefaults,
      checklist_items: ADDONS_FIXED_ITEMS,
      custom_items: addons,
      reject_reason_items: REJECT_REASON_ITEMS,
      maxRejectLeft: leftQuantity,
      maxRejectRight: rightQuantity,
    },
    metadata: { ...facts, station: 'addons' },
    schemaVersion: ACME_ADDONS_SCHEMA_VERSION,
  });

  if (!addonsResult) {
    return { type: 'return' as const, data: { cancelled: true, station: 'addons' } };
  }
  const addonsOutcome = await processAddons(addonsResult);
  if (addonsOutcome.outcome === 'Reject') {
    return { type: 'return' as const, data: addonsOutcome };
  }

  // ── Station 2: Final QA ────────────────────────────────────────────────────
  // The inspection ritual arrives unchecked — each confirmation is made on the
  // physical widgets, not from memory.
  const qaDefaults: Record<string, unknown> = {
    ...facts,
    outcome: '',
    checks: Object.fromEntries(QA_FIXED_ITEMS.map((item) => [item.id, false])),
  };

  const qaResult = await conditionLT<AcmeQaResolverV1>(`acme-qa-${ctx.workflowId}`, {
    role: ACME_QA_ROLE,
    type: 'station',
    subtype: 'final-qa',
    priority: 2,
    description: `Final QA — ${po} · ${widgetId}`,
    workflowType: 'acmeWidget',
    envelope: {
      source: 'acme-widget',
      formDefaults: qaDefaults,
      checklist_items: QA_FIXED_ITEMS,
      reject_reason_items: REJECT_REASON_ITEMS,
      maxRejectLeft: leftQuantity,
      maxRejectRight: rightQuantity,
    },
    metadata: { ...facts, station: 'final-qa' },
    schemaVersion: ACME_QA_SCHEMA_VERSION,
  });

  if (!qaResult) {
    return { type: 'return' as const, data: { cancelled: true, station: 'final-qa' } };
  }
  const qaOutcome = await processQa(qaResult);

  return {
    type: 'return' as const,
    data: {
      po,
      widgetId,
      addons: addonsOutcome,
      qa: qaOutcome,
      completed: qaOutcome.outcome === 'Pass',
    },
  };
}
