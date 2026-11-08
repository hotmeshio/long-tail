// One LabelContent per target: the template's codes composed under its scheme
// and its text rendered with the target's facts.

import { composeScanCode, ScanComposeError } from '../../shared/labels/compose';
import { renderLabelText } from '../../shared/labels/tokens';
import { SCAN_SCHEME_KINDS, type ScanRule, type ScanScheme } from '../../types';
import type { LabelContent, LabelWarning } from '../../shared/labels/types';
import type { LabelTarget, LabelTemplate } from '../../types/labels';

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
        caption: c.caption ?? rules.find((r) => r.category === c.category)?.name ?? '',
        tone: c.tone,
      }));
    } catch (err) {
      if (!(err instanceof ScanComposeError)) throw err;
      warnings.push({ index, kind: 'unparseable', detail: identity ? 'the bound credential does not fit the scheme' : err.message });
    }
    return {
      title: template.text.title ? renderLabelText(template.text.title, ctx) : undefined,
      lines: (template.text.lines ?? []).map((line) => renderLabelText(line, ctx)),
      codes,
      masked,
    };
  });
  return { contents, warnings };
}
