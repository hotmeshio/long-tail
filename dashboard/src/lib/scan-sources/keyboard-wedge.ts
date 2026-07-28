/**
 * Keyboard-wedge burst detector — pure state machine, no DOM access.
 *
 * A barcode scanner paired as an HID keyboard "types" the decoded string
 * rapidly and finishes with a terminator (Enter by default). The machine
 * distinguishes those bursts from human typing by inter-key interval:
 * humans type at 150-400ms per key, USB wedges at 10-30ms, and Bluetooth
 * HID on iPadOS at 20-100ms — the threshold sits above the scanner band
 * and below human speed, and is configurable per device.
 *
 * When the scanner is programmed with a prefix character, suppression is
 * airtight: the prefix flips the machine into capture mode before any
 * character can reach a focused input. Without a prefix, capture engages
 * once two characters arrive under the threshold, so the first character
 * may leak into a focused field (documented; program a prefix to avoid).
 */

export interface WedgeConfig {
  /** Max ms between keys to count as one burst. */
  interKeyThresholdMs: number;
  /** Keys that end a burst and submit the buffer. */
  terminators: string[];
  /** Min captured length to emit (filters stray fast keys). */
  minLength: number;
  /** Scanner-programmed preamble character ('' = none). */
  prefixChar: string;
}

export const WEDGE_DEFAULTS: WedgeConfig = {
  interKeyThresholdMs: 75,
  terminators: ['Enter', 'Tab'],
  minLength: 4,
  prefixChar: '',
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

export interface WedgeKey {
  /** KeyboardEvent.key */
  key: string;
  timeMs: number;
  /** Modifier held (ctrl/meta/alt) — never part of a scan. */
  hasModifier: boolean;
  /** KeyboardEvent.repeat — held-key auto-repeat, never a scan. */
  isRepeat: boolean;
}

export interface WedgeStep {
  /** Suppress this key from the page (capture-phase preventDefault). */
  suppress: boolean;
  /** A completed capture, when the key terminated a valid burst. */
  emit: string | null;
}

interface WedgeState {
  buffer: string;
  lastKeyMs: number;
  capturing: boolean;
}

export function createWedgeMachine(config: WedgeConfig = WEDGE_DEFAULTS) {
  let state: WedgeState = { buffer: '', lastKeyMs: 0, capturing: false };

  function reset(): void {
    state = { buffer: '', lastKeyMs: 0, capturing: false };
  }

  function step(input: WedgeKey): WedgeStep {
    const { key, timeMs, hasModifier, isRepeat } = input;

    if (hasModifier || isRepeat || key === 'Unidentified') {
      reset();
      return { suppress: false, emit: null };
    }

    if (config.terminators.includes(key)) {
      const code = state.buffer;
      const wasCapturing = state.capturing;
      reset();
      // A terminator closing an armed burst is always the scanner's suffix —
      // suppress it even when the capture is too short to emit, so a stray
      // Enter never submits a focused form.
      if (wasCapturing) {
        return { suppress: true, emit: code.length >= config.minLength ? code : null };
      }
      return { suppress: false, emit: null };
    }

    // Only single printable characters accumulate ('a', '1', ':').
    if (key.length !== 1) {
      reset();
      return { suppress: false, emit: null };
    }

    const delta = timeMs - state.lastKeyMs;
    const withinBurst = state.lastKeyMs > 0 && delta <= config.interKeyThresholdMs;

    // Prefix mode: the preamble character alone arms capture instantly.
    if (config.prefixChar && key === config.prefixChar && !state.capturing) {
      state = { buffer: '', lastKeyMs: timeMs, capturing: true };
      return { suppress: true, emit: null };
    }

    if (state.capturing) {
      if (withinBurst) {
        state.buffer += key;
        state.lastKeyMs = timeMs;
        return { suppress: true, emit: null };
      }
      // Burst went cold mid-capture — abandon it and restart from this key.
      state = { buffer: key, lastKeyMs: timeMs, capturing: false };
      return { suppress: false, emit: null };
    }

    // Not capturing: watch for a second character arriving scanner-fast.
    if (withinBurst && !config.prefixChar) {
      // The previous character (buffer) and this one form the burst head.
      state = { buffer: state.buffer + key, lastKeyMs: timeMs, capturing: true };
      return { suppress: true, emit: null };
    }

    state = { buffer: key, lastKeyMs: timeMs, capturing: false };
    return { suppress: false, emit: null };
  }

  return { step, reset };
}
