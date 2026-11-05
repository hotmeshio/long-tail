import { compilePattern } from '../../../../../shared/scan-code';

export type TargetMatch = 'value' | 'member';

/** The patterns textarea's lines as declared expressions. */
export function patternLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** The first line that does not compile, or null when every line does. */
function invalidPattern(text: string): string | null {
  return patternLines(text).find((p) => !compilePattern(p)) ?? null;
}

/** True when the patterns text declares at least one expression and every one compiles. */
export function patternsValid(text: string): boolean {
  return patternLines(text).length > 0 && invalidPattern(text) === null;
}

/**
 * How a scheme's target matches rows (one value, or a member of a list) and,
 * for pattern encoding, the expressions it reads and their order against gtin.
 */
export function SchemeMatchFields({
  encoding,
  isIdentity,
  targetMatch,
  onTargetMatch,
  patternsText,
  onPatternsText,
  precedesGtin,
  onPrecedesGtin,
}: {
  encoding: string;
  isIdentity: boolean;
  targetMatch: TargetMatch;
  onTargetMatch: (value: TargetMatch) => void;
  patternsText: string;
  onPatternsText: (value: string) => void;
  precedesGtin: boolean | null;
  onPrecedesGtin: (value: boolean | null) => void;
}) {
  const invalid = invalidPattern(patternsText);
  return (
    <>
      {!isIdentity && (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Target holds</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            {targetMatch === 'member'
              ? 'A list: a row matches when its list contains the scanned value.'
              : 'One value: a row matches when it equals the scanned value.'}
          </span>
          <select value={targetMatch} onChange={(e) => onTargetMatch(e.target.value as TargetMatch)} className="select">
            <option value="value">One value</option>
            <option value="member">A list of values</option>
          </select>
        </label>
      )}
      {encoding === 'pattern' && (
        <>
          <label className="block flex-1 min-w-[20rem]">
            <span className="block text-xs text-text-secondary mb-1">Patterns <span className="text-status-error">*</span></span>
            <span className="block text-2xs text-text-tertiary mb-1">
              One regular expression per line, matched against the whole code (up to 10).
            </span>
            <textarea
              value={patternsText}
              onChange={(e) => onPatternsText(e.target.value)}
              rows={3}
              className="input w-full font-mono"
              placeholder={'1Z[0-9A-Z]{16}\n[0-9]{12}'}
            />
            {invalid && <span className="block text-2xs text-status-error mt-1">Not a valid expression: {invalid}</span>}
          </label>
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Digits-only codes</span>
            <span className="block text-2xs text-text-tertiary mb-1">
              Which scheme reads a digits-only code that a manufacturer barcode scheme also reads.
              Required while a manufacturer barcode scheme is enabled.
            </span>
            <select
              value={precedesGtin === null ? '' : precedesGtin ? 'pattern' : 'gtin'}
              onChange={(e) => onPrecedesGtin(e.target.value === '' ? null : e.target.value === 'pattern')}
              className="select"
            >
              <option value="">Not declared</option>
              <option value="gtin">Manufacturer barcode first</option>
              <option value="pattern">These patterns first</option>
            </select>
          </label>
        </>
      )}
    </>
  );
}
