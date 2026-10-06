import { seedScanScheme, seedScanRule } from '../services/scan-code';
import { loggerRegistry } from '../lib/logger';
import { SCAN_VERBS, SCAN_ENCODINGS } from '../types';
import { ROLLUP_BIN_ROLE, ROLLUP_MEMBER_ROLE } from './workflows/rollup-bin';

const BAG_SCHEME_VERSION = 12;
const BIN_SCHEME_VERSION = 13;

/**
 * The bench motion over the rollup-bin example: bag, badge, bin.
 *
 * Scheme 12 is the bag label (12:0:<orderId>). Scanning it HOLDS the bag's
 * row: the station remembers it and asks for its bin. Scheme 13 is the bin
 * label (13:0:<binKey>). Scanning it while a bag is held places the bag:
 * the bag joins the bin's accumulator and the bag's own one-slot row
 * completes in the same statement. A bin the bag does not belong in is
 * refused with nothing written, naming the right one. The badge (scheme 11)
 * may come before the bag or between the bag and the bin.
 */
export async function seedBinScanCodes(): Promise<void> {
  try {
    await seedScanScheme({
      version: BAG_SCHEME_VERSION,
      name: 'Bag label',
      description: 'The sticker on each bag; scanning it holds the bag for its bin.',
      target_facet: 'orderId',
      encoding: SCAN_ENCODINGS.DELIMITED,
      delimiter: ':',
    });
    await seedScanScheme({
      version: BIN_SCHEME_VERSION,
      name: 'Bin label',
      description: 'The label on each bin; scanning it places the held bag.',
      target_facet: 'binKey',
      encoding: SCAN_ENCODINGS.DELIMITED,
      delimiter: ':',
    });
    await seedScanRule({
      scheme_version: BAG_SCHEME_VERSION,
      category: '0',
      name: 'Hold bag',
      steps: [
        {
          query: { roles: [ROLLUP_MEMBER_ROLE] },
          verb: SCAN_VERBS.HOLD,
          params: {
            hold: {
              ttlSeconds: 300,
              label: '{scan.target}',
              headline: '{item.binKey}',
              expect: { schemes: [BIN_SCHEME_VERSION], prompt: 'Walk to this bin and scan its label.' },
            },
          },
        },
        { query: { status: 'resolved' }, verb: SCAN_VERBS.SHOW_DETAIL },
      ],
      fallback: { markdown: '**No bag waiting for this label.**' },
    });
    await seedScanRule({
      scheme_version: BIN_SCHEME_VERSION,
      category: '0',
      name: 'Bin it',
      steps: [
        {
          query: { roles: [ROLLUP_BIN_ROLE] },
          verb: SCAN_VERBS.ACCUMULATE,
          requireActingIdentity: true,
          subject: { schemes: [BAG_SCHEME_VERSION] },
          match: { target: ['{subject.binKey}'] },
          refuse: {
            markdown: 'That is bin {scan.target}. This bag goes in **{subject.binKey}**.',
            conflict: 'That bin just closed. Scan it again for the next one.',
          },
          done: { markdown: 'Drop it in **{container.binKey}**. All good.' },
          params: {
            itemKey: '{subject.orderId}',
            accumulate: { from: 'subject', container: { types: ['rollup'], subtypes: ['bin'] } },
          },
        },
        { query: { roles: [ROLLUP_BIN_ROLE] }, verb: SCAN_VERBS.SHOW_DETAIL },
      ],
      fallback: { markdown: '**No open bin carries this label.** Start the bin, or scan the bag first.' },
      notPrimed: { markdown: '**Scan your badge to place the bag.**' },
    });
    loggerRegistry.info('[examples] scan-code schemes 12/13 verified (bag and bin labels)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed bin scan codes: ${err.message}`);
  }
}
