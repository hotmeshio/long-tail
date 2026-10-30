/**
 * What a printer's error code means, for the person the alarm row reaches.
 * Codes not listed read as the code itself; extend the list from the
 * printer's error reference as codes are met.
 */

const BY_CODE: Record<string, string> = {
  '07FF-8011': 'The external spool ran out of filament. Load filament and resume the print.',
  '0502-4007': 'The printer refused a command it could not verify. Turn on Developer Mode under LAN Only.',
};

/** Codes a printer shows briefly when a print is cancelled: an end, not a fault to raise. */
export const CANCEL_CODES: readonly string[] = ['0300-400C', '0500-400E'];

export function describeError(code: string): string {
  return BY_CODE[code] ?? `Printer error ${code}.`;
}
