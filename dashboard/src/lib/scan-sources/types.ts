/**
 * Scan input sources — the capture side of the scan-code system.
 *
 * A source watches a physical input channel (HID keyboard wedge, RFID
 * reader, camera) and emits captured code strings into one dispatch
 * pipeline. Execution is source-agnostic: the server takes a raw string.
 */

export interface ScanCapture {
  code: string;
  /** Which source produced the capture (e.g. 'keyboard-wedge', 'manual'). */
  source: string;
  capturedAt: number;
}

export type ScanEmit = (capture: ScanCapture) => void;

export interface ScanSource {
  /** Stable source identifier carried on every capture. */
  readonly id: string;
  /** Begin watching the channel. Returns a stop function. */
  start(emit: ScanEmit): () => void;
}

export const SCAN_SOURCE_IDS = {
  KEYBOARD_WEDGE: 'keyboard-wedge',
  MANUAL: 'manual',
  /** The header bar: a chosen command plus a typed target. */
  TOOLBAR: 'toolbar',
} as const;
export type ScanSourceId = (typeof SCAN_SOURCE_IDS)[keyof typeof SCAN_SOURCE_IDS];

/**
 * Marks an element whose inputs take a code as their own answer (a key-in).
 * Keys typed inside it reach only the field; the wedge capture skips them.
 */
export const SCAN_CAPTURE_ATTR = 'data-lt-scan-capture';
export const SCAN_CAPTURE_OFF = 'off';

/** True when the key's target sits inside an element that keeps its own keys. */
export function ownsItsKeys(target: EventTarget | null): boolean {
  return target instanceof Element
    && !!target.closest(`[${SCAN_CAPTURE_ATTR}="${SCAN_CAPTURE_OFF}"]`);
}
