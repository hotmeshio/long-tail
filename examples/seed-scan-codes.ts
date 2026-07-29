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
import { SCAN_VERBS, SCAN_ENCODINGS, type ScanStep } from '../types';
import {
  PRINTER_FLEET,
  PRINT_SERVICER,
  TWIN_FACETS,
  TWIN_STATE,
} from './workflows/printer-twin/types';

const SCHEME_VERSION = 10;

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

    loggerRegistry.info('[examples] scan-code scheme 10 verified (printer four-corner rules)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed scan codes: ${err.message}`);
  }
}
