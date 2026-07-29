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
 * The code vocabulary is ours, so the shape is strict:
 *   delimited — [1-9][0-9]:[0-9]:target, target of [a-zA-Z0-9._-]
 *   fixed     — 2 scheme digits + 1 category digit + 5+ target digits (digits only)
 * Typing a valid code and pressing Enter fires it too, anywhere — that is the
 * contract, not an accident: the scanner IS a keyboard, so the keyboard is a
 * scanner.
 */

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
 * The scan-code shapes, anchored to the END of the accumulated keys — the
 * code may follow unrelated text typed earlier in the same field.
 * Lowercase targets are the recommended vocabulary; capitals are accepted
 * and preserved (metadata matching is case-sensitive).
 */
const TAIL_SHAPES = [
  /[1-9][0-9]:[0-9]:[a-zA-Z0-9._-]+$/, // delimited: ##:#:target
  /[1-9][0-9]{7,}$/,                   // fixed: 2 scheme + 1 category + 5+ target digits
];

/** The longest scan-code tail of the buffer, or null. */
export function matchScanTail(buffer: string): string | null {
  let best: string | null = null;
  for (const shape of TAIL_SHAPES) {
    const m = buffer.match(shape);
    if (m && (!best || m[0].length > best.length)) best = m[0];
  }
  return best;
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

export function createWedgeMachine(config: WedgeConfig = WEDGE_DEFAULTS) {
  let state: WedgeState = { buffer: '', times: [], lastKeyMs: 0 };

  function reset(): void {
    state = { buffer: '', times: [], lastKeyMs: 0 };
  }

  function step(input: WedgeKey): WedgeStep {
    const { key, timeMs, hasModifier, isRepeat } = input;

    if (NEUTRAL_KEYS.has(key)) return PASS;

    if (config.terminators.includes(key)) {
      const code = matchScanTail(state.buffer);
      reset();
      if (code && code.length >= config.minLength) {
        return { suppress: true, emit: code, consumedLength: code.length };
      }
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
    const code = matchScanTail(state.buffer);
    if (!code || code.length < config.minLength) return null;
    const times = state.times.slice(-code.length);
    if (times.length < 2) return null;
    const avgKeyMs = (times[times.length - 1] - times[0]) / (times.length - 1);
    if (avgKeyMs > config.autoFireMaxAvgKeyMs) return null;
    return { code, consumedLength: code.length };
  }

  return { step, reset, snapshot, pendingAutoFire };
}
