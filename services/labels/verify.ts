// Flags labels that would fail on the floor: a code that does not parse back,
// a disabled rule or scheme, or a target that names nothing today.

import { parseScanCode } from '../../shared/scan-code/parse';
import { SCAN_SCHEME_KINDS, type ScanRule, type ScanScheme } from '../../types';
import type { LabelContent, LabelWarning } from '../../shared/labels/types';
import type { LabelTarget, LabelTemplate } from '../../types/labels';

export function verifyLabels(
  template: LabelTemplate,
  scheme: ScanScheme,
  schemes: ScanScheme[],
  rules: ScanRule[],
  targets: LabelTarget[],
  contents: LabelContent[],
): LabelWarning[] {
  const identity = scheme.kind === SCAN_SCHEME_KINDS.IDENTITY;
  const warnings: LabelWarning[] = [];
  if (!scheme.enabled) {
    contents.forEach((_c, index) => warnings.push({ index, kind: 'unparseable', detail: `scheme ${scheme.version} is disabled; its codes do not scan` }));
    return warnings;
  }
  const disabled = template.codes.filter((c) => !rules.find((r) => r.category === c.category)?.enabled);
  contents.forEach((content, index) => {
    for (const c of disabled) {
      warnings.push({ index, kind: 'rule_disabled', detail: `the rule for category ${c.category} is disabled; that code does nothing when scanned` });
    }
    for (const { code } of content.codes) {
      const parsed = parseScanCode(code, schemes);
      const same = parsed.ok && parsed.parsed.version === scheme.version && parsed.parsed.target === targets[index].target;
      if (!same) {
        warnings.push({
          index, kind: 'unparseable',
          detail: identity ? 'a badge code does not read back as this scheme' : `${code} does not read back as scheme ${scheme.version}`,
        });
      }
    }
    if (targets[index].resolved === false) {
      warnings.push({
        index, kind: 'unresolved',
        detail: identity ? 'the badge holder is not an active user' : `${targets[index].target} names no row today`,
      });
    }
  });
  return warnings;
}
