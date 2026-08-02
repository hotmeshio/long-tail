/**
 * Scan-code demo config — the four corners of a printer.
 *
 * Scheme 10 resolves scanned targets against the twin's `serialNumber` facet,
 * so a code stuck to a physical machine addresses its digital twin wherever
 * the twin's escalation currently lives. Each corner is one category:
 *
 *   0 upper-left  — Send Printer Home: cancel the twin's fleet row (with
 *      confirmation); the twin reacts by escalating to its service surface.
 *   1 upper-right — Collect Print: resolve the in-flight `printing` row as
 *      success — plate collected, machine reports done.
 *   2 lower-right — Print Failed: resolve the `printing` row as fail —
 *      plate cleared, machine reset, twin records the outcome.
 *   3 lower-left  — Offline for Service: cancel the fleet row AND open a
 *      service item in the servicer queue carrying the same serial.
 *
 * Every rule ends on a broad "show the item" step — a scan of a machine
 * whose twin is elsewhere reports where it actually is — and a fallback
 * screen for serials with no twin at all.
 *
 * Printer vocabulary lives HERE (seed/demo), never in the scan-code core.
 */

import { seedScanScheme, seedScanRule } from '../services/scan-code';
import { loggerRegistry } from '../lib/logger';
import { SCAN_VERBS, SCAN_ENCODINGS, SCAN_SCHEME_KINDS, type ScanStep } from '../types';
import {
  PRINTER_FLEET,
  PRINT_SERVICER,
  TWIN_FACETS,
  TWIN_STATE,
} from './workflows/printer-twin/types';
import {
  PRINTER_FLEET_ROLE,
  PRINTER_HARVEST_ROLE,
  PRINTER_SERVICE_ROLE,
} from './seed-fleet-sim';

const SCHEME_VERSION = 10;
const BADGE_SCHEME_VERSION = 11;

/** Every rule's terminal locator: report where the twin actually is. */
const SHOW_ANYWHERE: ScanStep = { query: {}, verb: SCAN_VERBS.SHOW_DETAIL };

const FALLBACK = {
  markdown:
    '**No twin found for this serial.**\n\n' +
    'The machine has no digital twin in any queue you can see. ' +
    'Register it through the onboarding surface, or check the serial on the label.',
};

export async function seedScanCodes(): Promise<void> {
  try {
    await seedScanScheme({
      version: SCHEME_VERSION,
      name: 'Printer serial',
      description: 'Codes on the four corners of each machine — targets the twin by serial number.',
      target_facet: TWIN_FACETS.SERIAL_NUMBER,
      encoding: SCAN_ENCODINGS.DELIMITED,
      delimiter: ':',
    });

    await seedScanRule({
      scheme_version: SCHEME_VERSION,
      category: '0',
      name: 'Send Printer Home',
      steps: [
        {
          query: { roles: [PRINTER_FLEET] },
          verb: SCAN_VERBS.CANCEL,
          confirm: {
            prompt:
              'Cancel this printer\'s current state and send it home to servicing?',
          },
        },
        SHOW_ANYWHERE,
      ],
      fallback: FALLBACK,
    });

    await seedScanRule({
      scheme_version: SCHEME_VERSION,
      category: '1',
      name: 'Collect Print',
      steps: [
        {
          query: { roles: [PRINTER_FLEET], facets: { [TWIN_FACETS.STATE]: TWIN_STATE.PRINTING } },
          verb: SCAN_VERBS.RESOLVE,
          params: {
            resolverPayload: {
              outcome: 'success',
              detail: 'Collected at the machine — plate cleared ({scan.scannedAt})',
            },
          },
        },
        SHOW_ANYWHERE,
      ],
      fallback: FALLBACK,
    });

    await seedScanRule({
      scheme_version: SCHEME_VERSION,
      category: '2',
      name: 'Print Failed',
      steps: [
        {
          query: { roles: [PRINTER_FLEET], facets: { [TWIN_FACETS.STATE]: TWIN_STATE.PRINTING } },
          verb: SCAN_VERBS.RESOLVE,
          params: {
            resolverPayload: {
              outcome: 'fail',
              detail: 'Failed at the machine — plate cleared and machine reset ({scan.scannedAt})',
            },
          },
        },
        SHOW_ANYWHERE,
      ],
      fallback: FALLBACK,
    });

    await seedScanRule({
      scheme_version: SCHEME_VERSION,
      category: '3',
      name: 'Offline for Service',
      steps: [
        {
          query: { roles: [PRINTER_FLEET] },
          verb: SCAN_VERBS.ESCALATE,
          params: {
            targetRole: PRINT_SERVICER,
            closeCurrent: 'cancel',
            escalationType: TWIN_STATE.SERVICE,
            description: 'Machine taken offline at the floor',
            metadata: { serviceReason: 'Taken offline by scan at {scan.scannedAt}' },
          },
        },
        SHOW_ANYWHERE,
      ],
      fallback: FALLBACK,
    });

    // Category 4 — the single-code screen interaction: one code on the item,
    // many possible intents, the right one depending on where the item is in
    // its journey. The scan locates the row across the whole printer floor
    // and PRESENTS reality + labeled choices; mutating choices demand a real
    // acting identity, so a read-only station stays read-only until a badge
    // primes the session.
    await seedScanRule({
      scheme_version: SCHEME_VERSION,
      category: '4',
      name: 'Work Item',
      steps: [
        {
          query: { roles: [PRINTER_FLEET_ROLE, PRINTER_HARVEST_ROLE, PRINTER_SERVICE_ROLE] },
          verb: SCAN_VERBS.PRESENT,
          choices: [
            {
              label: 'Claim & Start',
              verb: SCAN_VERBS.CLAIM,
              requireActingIdentity: true,
              code: 'CLAIM',
              params: { durationMinutes: 120 },
            },
            {
              label: 'Complete',
              verb: SCAN_VERBS.RESOLVE,
              requireActingIdentity: true,
              code: 'DONE',
              confirm: { prompt: 'Mark this item complete?' },
              params: {
                resolverPayload: {
                  outcome: 'complete',
                  detail: 'Completed at the station ({scan.scannedAt})',
                },
              },
            },
            {
              label: 'Send to Service',
              verb: SCAN_VERBS.ESCALATE,
              requireActingIdentity: true,
              confirm: { prompt: 'Take this machine offline and open a service item?' },
              params: {
                targetRole: PRINTER_SERVICE_ROLE,
                closeCurrent: 'cancel',
                escalationType: 'service',
                description: 'Sent to service from the station screen',
              },
            },
            { label: 'View Details', verb: SCAN_VERBS.SHOW_DETAIL },
          ],
        },
        SHOW_ANYWHERE,
      ],
      fallback: FALLBACK,
      notPrimed: {
        markdown: '**Scan your badge to act.**\n\nThe station can read this item, but claiming or completing attributes to a person — scan your badge first.',
      },
    });

    // Category 5 — the one-scan claim: a station worker scans the item that
    // just arrived and it is theirs, claimed for the shift's duration, with
    // the escalation detail page (the work form) as the landing. When no
    // badge is primed, the scan stops over at the badge screen instead —
    // the auto-select never fires as the wrong person.
    await seedScanRule({
      scheme_version: SCHEME_VERSION,
      category: '5',
      name: 'Claim & Work',
      steps: [
        {
          query: {
            roles: [PRINTER_FLEET_ROLE, PRINTER_HARVEST_ROLE, PRINTER_SERVICE_ROLE],
            availability: 'available',
          },
          verb: SCAN_VERBS.PRESENT,
          autoSelectSingle: true,
          choices: [
            {
              label: 'Claim & Work',
              verb: SCAN_VERBS.CLAIM_SHOW_DETAIL,
              requireActingIdentity: true,
              params: { durationMinutes: 120 },
            },
          ],
        },
        SHOW_ANYWHERE,
      ],
      fallback: FALLBACK,
      notPrimed: {
        markdown: '**Scan your badge to claim.**\n\nClaiming attributes the work to a person — badge in and the claim completes on its own.',
      },
    });

    loggerRegistry.info('[examples] scan-code scheme 10 verified (printer four-corner rules)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed scan codes: ${err.message}`);
  }
}

/**
 * The badge layer: scheme 11 resolves scanned badge tokens against
 * lt_users.metadata.badge_id and mints a five-minute acting-identity grant.
 * Badge tokens are opaque printed credentials (never usernames); the demo
 * associate carries one via examples/seed-data.ts.
 */
export async function seedBadgeScheme(): Promise<void> {
  try {
    await seedScanScheme({
      version: BADGE_SCHEME_VERSION,
      name: 'Associate badge',
      description: 'Badge scans prime the station with the associate\'s acting identity.',
      target_facet: 'badge_id',
      encoding: SCAN_ENCODINGS.DELIMITED,
      delimiter: ':',
      kind: SCAN_SCHEME_KINDS.IDENTITY,
      grant_ttl_seconds: 300,
      grant_max_uses: 0,
    });
    await seedScanRule({
      scheme_version: BADGE_SCHEME_VERSION,
      category: '0',
      name: 'Badge in',
      steps: [],
      fallback: {
        markdown: '**Badge not recognized.**\n\nThe badge carries no active binding. See your supervisor to link it.',
      },
    });
    loggerRegistry.info('[examples] scan-code scheme 11 verified (associate badge)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed badge scheme: ${err.message}`);
  }
}
