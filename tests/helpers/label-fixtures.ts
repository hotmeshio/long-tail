import { getPool } from '../../lib/db';
import * as userService from '../../services/user';
import { deleteScanScheme, upsertScanRule, upsertScanScheme } from '../../services/scan-code';
import { deleteLabelTemplate, upsertLabelTemplate } from '../../services/labels';
import { SCAN_ENCODINGS, SCAN_SCHEME_KINDS } from '../../types/scan-code';
import type { LabelTemplateInput } from '../../types/labels';

/** Scan schemes, templates and users for label tests; `cleanup` removes them and their ledger rows. */
export interface LabelFixtures {
  itemScheme: number;
  badgeScheme: number;
  itemFacet: string;
  badgeKey: string;
  itemTemplate: string;
  badgeTemplate: string;
  users: string[];
  mkUser(metadata?: Record<string, unknown>, roles?: Array<{ role: string; type: 'member' | 'admin' | 'superadmin' }>): Promise<string>;
  cleanup(): Promise<void>;
}

const rule = (scheme: number, category: string, name: string) => ({
  scheme_version: scheme, category, name, steps: [], fallback: { markdown: name },
});

export async function createLabelFixtures(base: number, tag: string): Promise<LabelFixtures> {
  const itemScheme = base;
  const badgeScheme = base + 1;
  const itemFacet = `${tag}_item`;
  const badgeKey = `${tag}_badge`;
  const itemTemplate = `${tag}-item`.replace(/_/g, '-');
  const badgeTemplate = `${tag}-badge`.replace(/_/g, '-');
  const users: string[] = [];

  await upsertScanScheme({ version: itemScheme, name: 'Test items', target_facet: itemFacet, encoding: SCAN_ENCODINGS.DELIMITED, delimiter: ':' });
  await upsertScanRule(rule(itemScheme, '0', 'Check in'));
  await upsertScanRule(rule(itemScheme, '1', 'Check out'));
  await upsertScanScheme({
    version: badgeScheme, name: 'Test badge', target_facet: badgeKey, encoding: SCAN_ENCODINGS.DELIMITED, delimiter: ':',
    kind: SCAN_SCHEME_KINDS.IDENTITY, grant_ttl_seconds: 300, grant_max_uses: 1,
  });
  await upsertScanRule(rule(badgeScheme, '0', 'Badge in'));

  const twoCode: LabelTemplateInput = {
    name: itemTemplate, scheme_version: itemScheme, title: 'Test two-code label',
    codes: [{ category: '0', tone: 'solid' }, { category: '1', tone: 'outline' }],
    text: { title: '{target}', lines: ['{item.subtitle}'] },
  };
  await upsertLabelTemplate(twoCode);
  await upsertLabelTemplate({
    name: badgeTemplate, scheme_version: badgeScheme, title: 'Test badge', media: 'a4-cr80', human_readable: false,
    codes: [{ category: '0', tone: 'plain' }], text: { title: '{user.display_name}', lines: ['{user.roles}'] },
  });

  return {
    itemScheme, badgeScheme, itemFacet, badgeKey, itemTemplate, badgeTemplate, users,
    async mkUser(metadata = {}, roles) {
      const user = await userService.createUser({
        external_id: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        display_name: `${tag} user`,
        metadata: metadata as Record<string, any>,
        roles,
      });
      users.push(user.id);
      return user.id;
    },
    async cleanup() {
      await getPool().query('DELETE FROM lt_label_jobs WHERE template_name = ANY($1) OR subject_user_ids && $2::uuid[]', [[itemTemplate, badgeTemplate], users]);
      await deleteLabelTemplate(itemTemplate);
      await deleteLabelTemplate(badgeTemplate);
      for (const id of users) await userService.deleteUser(id);
      await deleteScanScheme(itemScheme);
      await deleteScanScheme(badgeScheme);
    },
  };
}
