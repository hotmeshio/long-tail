/**
 * Acme Order — the reference two-station manufacturing flow behind the
 * "perfect form" pair. One order walks Addons → Post-print QA; each station is
 * a role-owned, versioned escalation form (see forms.ts for the form doctrine).
 *
 * The workflow builds each station's envelope from the order:
 *   - `checklist_items` — the station's standard confirmations. At Addons they
 *     arrive PRE-CHECKED through formDefaults: the standard is the default,
 *     the resolver unchecks what isn't true.
 *   - `custom_items` — the order's own addon work, named item by item,
 *     unchecked: those are the clicks that matter.
 *   - `reject_reason_items` + `maxRejectLeft/Right` — the report vocabulary
 *     and the caps the form validates against.
 *   - `formDefaults` — reverse-mapped through each form's x-lt-bind so the
 *     facts dictionary renders the order and the decision opens on "Choose…".
 *
 * A rejection at either station ends the run with the report; QA Pass
 * completes the order.
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

export interface AcmeOrderEnvelopeData {
  po?: string;
  orderId?: string;
  leftQuantity?: number;
  rightQuantity?: number;
  orthoticType?: string;
  shoeSize?: string;
  material?: string;
  certified?: boolean;
  /** The order's addon work — each becomes a clickable custom-work item. */
  addons?: Array<{ id: string; label: string }>;
}

const ADDONS_FIXED_ITEMS: AcmeChecklistItem[] = [
  { id: 'attached', label: 'Every addon attached per the order' },
  { id: 'angles', label: 'Posting angles verified against the order (medial/lateral, degrees)' },
];

const QA_FIXED_ITEMS: AcmeChecklistItem[] = [
  { id: 'counts', label: 'Counts match the order — physical prints vs the left/right quantities' },
  { id: 'strings', label: 'No loose strings or burrs — sweep both pieces, top and bottom' },
  { id: 'layers', label: 'No layer separation — flex each piece gently' },
  { id: 'flat', label: 'Sits flat — no warping on the table' },
];

const REJECT_REASON_ITEMS: AcmeChecklistItem[] = [
  { id: 'strings', label: 'Strings or burrs' },
  { id: 'separation', label: 'Layer separation' },
  { id: 'warping', label: 'Warping' },
  { id: 'fill', label: 'Incomplete fill' },
  { id: 'material', label: 'Wrong material' },
  { id: 'damage', label: 'Handling damage' },
];

export async function acmeOrder(envelope: LTEnvelope): Promise<any> {
  const {
    po = 'ACME-1042',
    orderId = 'ord-8127',
    leftQuantity = 1,
    rightQuantity = 1,
    orthoticType = 'Functional',
    shoeSize = 'M10',
    material = 'polymax',
    certified = false,
    addons = [
      { id: 'wedge_medial', label: 'Wedge — medial, left — verified on the piece' },
      { id: 'met_pad', label: 'Met pad — standard — verified on the piece' },
    ],
  } = (envelope.data ?? {}) as AcmeOrderEnvelopeData;

  const { processAddons, processQa } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
  });

  const ctx = Durable.workflow.workflowInfo();

  // The facts ride both surfaces: metadata (searchable facets) and
  // formDefaults (the form's dictionary rows).
  const facts = {
    po,
    orderId,
    leftQuantity: String(leftQuantity),
    rightQuantity: String(rightQuantity),
    orthoticType,
    shoeSize,
    material,
    certified: certified ? 'true' : 'false',
  };

  // ── Station 1: Addons ──────────────────────────────────────────────────────
  // The standard confirmations arrive pre-checked; the order's own addon work
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
    description: `Addons — ${po} · ${orderId}`,
    workflowType: 'acmeOrder',
    envelope: {
      source: 'acme-order',
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

  // ── Station 2: Post-print QA ───────────────────────────────────────────────
  // The inspection ritual arrives unchecked — each confirmation is made on the
  // physical prints, not from memory.
  const qaDefaults: Record<string, unknown> = {
    ...facts,
    outcome: '',
    checks: Object.fromEntries(QA_FIXED_ITEMS.map((item) => [item.id, false])),
  };

  const qaResult = await conditionLT<AcmeQaResolverV1>(`acme-qa-${ctx.workflowId}`, {
    role: ACME_QA_ROLE,
    type: 'station',
    subtype: 'post-print-qa',
    priority: 2,
    description: `Post-print QA — ${po} · ${orderId}`,
    workflowType: 'acmeOrder',
    envelope: {
      source: 'acme-order',
      formDefaults: qaDefaults,
      checklist_items: QA_FIXED_ITEMS,
      reject_reason_items: REJECT_REASON_ITEMS,
      maxRejectLeft: leftQuantity,
      maxRejectRight: rightQuantity,
    },
    metadata: { ...facts, station: 'post-print-qa' },
    schemaVersion: ACME_QA_SCHEMA_VERSION,
  });

  if (!qaResult) {
    return { type: 'return' as const, data: { cancelled: true, station: 'post-print-qa' } };
  }
  const qaOutcome = await processQa(qaResult);

  return {
    type: 'return' as const,
    data: {
      po,
      orderId,
      addons: addonsOutcome,
      qa: qaOutcome,
      completed: qaOutcome.outcome === 'Pass',
    },
  };
}
