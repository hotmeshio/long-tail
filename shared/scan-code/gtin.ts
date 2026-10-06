// GTIN (UPC-A, EAN-13, EAN-8, GTIN-14) check digits and normalization.
// Pure; shared by the server parser and the dashboard's scan capture.

export const GTIN_CODE_LENGTHS: readonly number[] = [8, 12, 13, 14];

/** True when `code` is all digits, a GTIN length, and its mod-10 check digit holds. */
export function isValidGtin(code: string): boolean {
  if (!/^[0-9]+$/.test(code) || !GTIN_CODE_LENGTHS.includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // Weights run 3,1,3,1… from the digit nearest the check digit.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** The 14-digit form of a valid GTIN: UPC-A, EAN-13 and EAN-8 left-padded with zeros. */
export function normalizeGtin(code: string): string {
  return code.padStart(14, '0');
}
