/**
 * Keyboard-wedge capture — pure state machine, no DOM access.
 *
 * A scanner paired as an HID keyboard "types" its decode and finishes with a
 * terminator (Enter). Capture is PATTERN-ANCHORED, not timing-triggered: keys
 * accumulate freely (nothing is suppressed while they flow), and when the
 * terminator arrives the machine checks whether the recent keys end with a
 * scan-code shape. On a match it suppresses the terminator, reports how many
 * characters to strip from the focused editable, and emits the code. This
 * survives every scanner pacing quirk — slow Bluetooth HID links, chorded
 * Shift keys for capitals and ':', stalls mid-burst — because nothing has to
 * be recognized mid-flight.
 *
 * The shapes come from the configured schemes (see buildTailShapes):
 *   delimited: VV:C:target per scheme version, target of [a-zA-Z0-9._-]
 *   fixed:     VV + category + exactly the scheme's target digits
 *   gtin:      a whole 8/12/13/14-digit run whose check digit holds
 * Until the schemes load, generic shapes stand in. Typing a delimited code
 * and pressing Enter fires it too, anywhere: the scanner IS a keyboard. A
 * digits-only code fires only at scanner speed, so a typed PO number or
 * count followed by Enter stays in its field.
 */

import { isValidGtin } from '../../../../shared/scan-code';

export interface WedgeConfig {
  /** Max ms between keys before the accumulator restarts. Generous by design —
   *  it only separates distinct typing episodes, it does not detect scanners. */
  maxKeyGapMs: number;
  /** Keys that end an episode and submit the accumulated tail. */
  terminators: string[];
  /** Min captured length to emit (filters stray fragments). */
  minLength: number;
  /**
   * Auto-fire for scanners with no suffix programmed: when the buffer ends in
   * a full code shape typed at scanner speed, this quiet period with no
   * further keys stands in for the terminator.
   */
  autoFireQuietMs: number;
  /**
   * Scanner-speed ceiling for auto-fire: average ms per key across the code.
   * Scanners run 1-30ms; human typing runs 120ms+ — hand-typed codes never
   * auto-fire, they submit on Enter or the Go button.
   */
  autoFireMaxAvgKeyMs: number;
}

export const WEDGE_DEFAULTS: WedgeConfig = {
  maxKeyGapMs: 500,
  terminators: ['Enter', 'Tab'],
  minLength: 6,
  autoFireQuietMs: 300,
  autoFireMaxAvgKeyMs: 50,
};

const WEDGE_CONFIG_STORAGE_KEY = 'lt_scan_wedge_config';

export function loadWedgeConfig(): WedgeConfig {
  try {
    const raw = localStorage.getItem(WEDGE_CONFIG_STORAGE_KEY);
    if (!raw) return WEDGE_DEFAULTS;
    return { ...WEDGE_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return WEDGE_DEFAULTS;
  }
}

export function saveWedgeConfig(config: Partial<WedgeConfig>): WedgeConfig {
  const merged = { ...loadWedgeConfig(), ...config };
  localStorage.setItem(WEDGE_CONFIG_STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

/**
 * One recognizable code shape, anchored to the END of the accumulated keys
 * (the code may follow unrelated text typed earlier in the same field). The
 * code is capture group 1; the group before it is a boundary, so a code never
 * starts in the middle of a longer run of digits.
 */
export interface TailShape {
  pattern: RegExp;
  /** Digits only: fires only when the code arrived at scanner speed. */
  digitsOnly: boolean;
  /** Extra acceptance test on the matched code (e.g. a GTIN check digit). */
  accept?: (code: string) => boolean;
}

/** The scheme fields capture reads. */
export interface CaptureScheme {
  version: number;
  encoding: 'fixed' | 'delimited' | 'gtin';
  delimiter: string;
  target_length: number | null;
  enabled: boolean;
}

/** Generic shapes for before the schemes load. */
export const DEFAULT_TAIL_SHAPES: TailShape[] = [
  { pattern: /(?:^|[^0-9])([1-9][0-9]:[0-9]:[a-zA-Z0-9._-]+)$/, digitsOnly: false },
  { pattern: /(?:^|[^0-9])([1-9][0-9]{7,})$/, digitsOnly: true },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The shapes the configured schemes read. Identity (badge) schemes included. */
export function buildTailShapes(schemes: CaptureScheme[]): TailShape[] {
  const shapes: TailShape[] = [];
  for (const scheme of schemes.filter((s) => s.enabled)) {
    if (scheme.encoding === 'delimited') {
      const d = escapeRegExp(scheme.delimiter);
      shapes.push({
        pattern: new RegExp(`(?:^|[^0-9])(${scheme.version}${d}[0-9]${d}[a-zA-Z0-9._-]+)$`),
        digitsOnly: false,
      });
    } else if (scheme.encoding === 'fixed') {
      const digits = 1 + (scheme.target_length ?? 0);
      shapes.push({
        pattern: new RegExp(`(?:^|[^0-9])(${scheme.version}[0-9]{${digits},${digits + 1}})$`),
        digitsOnly: true,
      });
    } else if (scheme.encoding === 'gtin') {
      shapes.push({
        pattern: /(?:^|[^0-9])([0-9]{8}|[0-9]{12,14})$/,
        digitsOnly: true,
        accept: isValidGtin,
      });
    }
  }
  return shapes.length ? shapes : DEFAULT_TAIL_SHAPES;
}

/** The longest scan-code tail of the buffer, with its shape, or null. */
export function matchScanShape(
  buffer: string,
  shapes: TailShape[] = DEFAULT_TAIL_SHAPES,
): { code: string; shape: TailShape } | null {
  let best: { code: string; shape: TailShape } | null = null;
  for (const shape of shapes) {
    const code = buffer.match(shape.pattern)?.[1];
    if (!code || (shape.accept && !shape.accept(code))) continue;
    if (!best || code.length > best.code.length) best = { code, shape };
  }
  return best;
}

/** The longest scan-code tail of the buffer, or null. */
export function matchScanTail(buffer: string, shapes: TailShape[] = DEFAULT_TAIL_SHAPES): string | null {
  return matchScanShape(buffer, shapes)?.code ?? null;
}

export interface WedgeKey {
  /** KeyboardEvent.key */
  key: string;
  timeMs: number;
  /** Modifier held (ctrl/meta/alt) — a chord, never scan content. */
  hasModifier: boolean;
  /** KeyboardEvent.repeat — held-key auto-repeat, never scan content. */
  isRepeat: boolean;
}

export interface WedgeStep {
  /** Suppress this key from the page. Only a matched terminator suppresses. */
  suppress: boolean;
  /** The captured code, when the terminator closed a matching tail. */
  emit: string | null;
  /**
   * With emit: how many characters of the code reached the page and should
   * be stripped from the focused editable (always the code's full length —
   * accumulation never suppresses).
   */
  consumedLength?: number;
}

interface WedgeState {
  buffer: string;
  /** Arrival time of each buffered character, aligned with `buffer`. */
  times: number[];
  lastKeyMs: number;
}

const MAX_BUFFER = 128;

/**
 * Chord keydowns that ride along with typed characters without being
 * characters: scanners send ':' and capitals as Shift chords, so bare Shift
 * keydowns interleave every scan. Neutral — no state change.
 */
const NEUTRAL_KEYS = new Set(['Shift', 'CapsLock']);

const PASS: WedgeStep = { suppress: false, emit: null };

export function createWedgeMachine(
  config: WedgeConfig = WEDGE_DEFAULTS,
  shapes: TailShape[] = DEFAULT_TAIL_SHAPES,
) {
  let state: WedgeState = { buffer: '', times: [], lastKeyMs: 0 };

  /** True when the code's characters arrived at scanner speed. */
  function scannerPaced(code: string): boolean {
    const times = state.times.slice(-code.length);
    if (times.length < 2) return false;
    const avgKeyMs = (times[times.length - 1] - times[0]) / (times.length - 1);
    return avgKeyMs <= config.autoFireMaxAvgKeyMs;
  }

  /** The tail to emit now, honoring minLength and the digits-only speed gate. */
  function capturable(): string | null {
    const match = matchScanShape(state.buffer, shapes);
    if (!match || match.code.length < config.minLength) return null;
    if (match.shape.digitsOnly && !scannerPaced(match.code)) return null;
    return match.code;
  }

  function reset(): void {
    state = { buffer: '', times: [], lastKeyMs: 0 };
  }

  function step(input: WedgeKey): WedgeStep {
    const { key, timeMs, hasModifier, isRepeat } = input;

    if (NEUTRAL_KEYS.has(key)) return PASS;

    if (config.terminators.includes(key)) {
      const code = capturable();
      reset();
      if (code) return { suppress: true, emit: code, consumedLength: code.length };
      return PASS;
    }

    // Chords, auto-repeats, and non-printable keys (arrows, Backspace,
    // 'Unidentified') mark editing activity — the accumulated text no longer
    // mirrors what sits before the cursor, so restart.
    if (hasModifier || isRepeat || key.length !== 1) {
      reset();
      return PASS;
    }

    const gap = timeMs - state.lastKeyMs;
    const continues = state.lastKeyMs > 0 && gap <= config.maxKeyGapMs;
    const buffer = (continues ? state.buffer + key : key).slice(-MAX_BUFFER);
    const times = (continues ? [...state.times, timeMs] : [timeMs]).slice(-MAX_BUFFER);
    state = { buffer, times, lastKeyMs: timeMs };
    return PASS;
  }

  /** Current accumulator contents — read by the diagnostics view. */
  function snapshot(): { buffer: string } {
    return { buffer: state.buffer };
  }

  /**
   * The auto-fire candidate for scanners that send no suffix: the buffer ends
   * in a full code shape AND its keys arrived at scanner speed. The caller
   * fires it after `autoFireQuietMs` of silence and resets the machine.
   */
  function pendingAutoFire(): { code: string; consumedLength: number } | null {
    const code = capturable();
    if (!code || !scannerPaced(code)) return null;
    return { code, consumedLength: code.length };
  }

  return { step, reset, snapshot, pendingAutoFire };
}
