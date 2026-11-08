// One LabelContent per target: the template's codes composed under its scheme
// and its text rendered with the target's facts.

import { composeScanCode, ScanComposeError } from '../../shared/labels/compose';
import { listLabelTokens, renderLabelText, type LabelTokenContext } from '../../shared/labels/tokens';
import { SCAN_SCHEME_KINDS, type ScanRule, type ScanScheme } from '../../types';
import type { LabelContent, LabelWarning } from '../../shared/labels/types';
import type { LabelTarget, LabelTemplate } from '../../types/labels';

const KEYS_NAMED = 6;

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
}

/**
 * Tokens a label's text reads that its own facts lack: `line 1 reads
 * {item.region}, which this label's data doesn't have`. Names the facts it
 * does have, never their values.
 */
function missingTokens(texts: Array<[string, string]>, ctx: LabelTokenContext, index: number): LabelWarning[] {
  const warnings: LabelWarning[] = [];
  const seen = new Set<string>();
  for (const [where, text] of texts) {
    for (const token of listLabelTokens(text)) {
      const [bag, key] = token.split('.', 2);
      if ((bag !== 'item' && bag !== 'user') || !key || seen.has(token)) continue;
      const facts = (bag === 'item' ? ctx.item : ctx.user) ?? {};
      if (present(facts[key])) continue;
      seen.add(token);
      const has = Object.keys(facts).filter((k) => present(facts[k]));
      warnings.push({
        index,
        kind: 'missing_token',
        detail: `${where} reads {${token}}, which this label's data doesn't have` +
          (has.length ? ` (it has: ${has.slice(0, KEYS_NAMED).join(', ')}${has.length > KEYS_NAMED ? ', …' : ''})` : ''),
      });
    }
  }
  return warnings;
}

export interface BuiltContents {
  contents: LabelContent[];
  warnings: LabelWarning[];
}

/**
 * Compose every label. A target the scheme cannot carry (a fixed scheme's
 * target with letters) prints its text without codes and is reported;
 * identity warnings never repeat the target, which is the credential.
 */
export function buildLabelContents(
  template: LabelTemplate,
  scheme: ScanScheme,
  rules: ScanRule[],
  targets: LabelTarget[],
  masked: boolean,
): BuiltContents {
  const identity = scheme.kind === SCAN_SCHEME_KINDS.IDENTITY;
  const warnings: LabelWarning[] = [];
  const contents = targets.map((t, index) => {
    const ctx = { target: t.target, item: t.item, user: t.user, scheme: { name: scheme.name } };
    let codes: LabelContent['codes'] = [];
    try {
      codes = template.codes.map((c) => ({
        code: composeScanCode(scheme, c.category, t.target),
        // Only template captions carry tokens; a rule's name prints as written.
        caption: c.caption != null
          ? renderLabelText(c.caption, ctx)
          : rules.find((r) => r.category === c.category)?.name ?? '',
        tone: c.tone,
      }));
    } catch (err) {
      if (!(err instanceof ScanComposeError)) throw err;
      warnings.push({ index, kind: 'unparseable', detail: identity ? 'the bound credential does not fit the scheme' : err.message });
    }
    const lines = template.text.lines ?? [];
    warnings.push(...missingTokens([
      ['the heading', template.text.title ?? ''],
      ...lines.map((line, i): [string, string] => [`line ${i + 1}`, line]),
      ...template.codes.map((c, i): [string, string] => [`caption ${i + 1}`, c.caption ?? '']),
    ], ctx, index));
    return {
      title: template.text.title ? renderLabelText(template.text.title, ctx) : undefined,
      lines: lines.map((line) => renderLabelText(line, ctx)),
      codes,
      masked,
    };
  });
  return { contents, warnings };
}
