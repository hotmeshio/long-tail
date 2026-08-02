import { useEffect, useRef } from 'react';
import { createWedgeMachine, type WedgeConfig } from '../lib/scan-sources/keyboard-wedge';
import { removeFromActiveEditable } from '../lib/scan-sources/editable-repair';

/** One observed keydown, as the capture machine saw it. */
export interface ScanKeyDiag {
  seq: number;
  key: string;
  /** KeyboardEvent.code when it names a different physical key. */
  code: string;
  /** ms since the previous observed keydown. */
  deltaMs: number;
  /** Accumulator contents after this key. */
  buffer: string;
  note: string;
}

/**
 * The HID keyboard-wedge source: one capture-phase window listener sees every
 * key before focused inputs do; the burst machine decides which keys belong
 * to a scan and directs their suppression. Captured codes reach `onScan`;
 * with diagnostics on, every observed keydown reaches `onDiag` too.
 */
export function useWedgeCapture({
  active,
  wedgeConfig,
  diagnosticsOn,
  onScan,
  onDiag,
}: {
  active: boolean;
  wedgeConfig: WedgeConfig;
  diagnosticsOn: boolean;
  onScan: (code: string) => void;
  onDiag: (entry: ScanKeyDiag) => void;
}): void {
  // Live refs so the listener stays installed across renders.
  const liveRef = useRef({ diagnosticsOn, onScan, onDiag });
  liveRef.current = { diagnosticsOn, onScan, onDiag };
  const diagSeqRef = useRef(0);
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const machine = createWedgeMachine(wedgeConfig);
    let autoFireTimer: ReturnType<typeof setTimeout> | null = null;

    const clearAutoFire = () => {
      if (autoFireTimer) { clearTimeout(autoFireTimer); autoFireTimer = null; }
    };

    const fire = (code: string, consumedLength: number, note: string) => {
      if (consumedLength) removeFromActiveEditable(consumedLength);
      if (liveRef.current.diagnosticsOn) {
        // eslint-disable-next-line no-console
        console.debug('[scan]', note);
        liveRef.current.onDiag({
          seq: ++diagSeqRef.current, key: '(quiet)', code: '', deltaMs: 0, buffer: '', note,
        });
      }
      liveRef.current.onScan(code);
    };

    // Scanners with no suffix programmed never send a terminator — when the
    // buffer ends in a full code typed at scanner speed, a quiet period
    // stands in for the Enter.
    const scheduleAutoFire = () => {
      clearAutoFire();
      if (!machine.pendingAutoFire()) return;
      autoFireTimer = setTimeout(() => {
        autoFireTimer = null;
        const pending = machine.pendingAutoFire();
        if (!pending) return;
        machine.reset();
        fire(pending.code, pending.consumedLength, `capture → ${pending.code} (quiet period — no suffix)`);
      }, wedgeConfig.autoFireQuietMs);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const bufferBefore = machine.snapshot().buffer;
      const { suppress, emit, consumedLength } = machine.step({
        key: e.key,
        timeMs: e.timeStamp,
        hasModifier: e.ctrlKey || e.metaKey || e.altKey,
        isRepeat: e.repeat,
      });
      if (suppress) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Diagnostics: what the machine saw and what it decided, key by key —
      // the panel view for chasing scanner-specific stream shapes.
      if (liveRef.current.diagnosticsOn) {
        const bufferAfter = machine.snapshot().buffer;
        const isTerminator = wedgeConfig.terminators.includes(e.key);
        const note = emit
          ? `capture → ${emit}`
          : isTerminator
            ? `terminator — no code tail in "${bufferBefore.slice(-24)}"`
            : bufferAfter === bufferBefore
              ? bufferBefore ? 'neutral (chord key)' : 'ignored'
              : bufferAfter === ''
                ? 'reset (edit/chord/non-printable)'
                : bufferAfter.length <= 1 && bufferBefore.length > 1
                  ? 'gap — new episode'
                  : 'accumulate';
        const deltaMs = lastKeyAtRef.current ? Math.round(e.timeStamp - lastKeyAtRef.current) : 0;
        const entry: ScanKeyDiag = {
          seq: ++diagSeqRef.current,
          key: e.key,
          code: e.code !== e.key ? e.code : '',
          deltaMs,
          buffer: bufferAfter.slice(-24),
          note,
        };
        // eslint-disable-next-line no-console
        console.debug('[scan]', entry.key, entry.code, `${entry.deltaMs}ms`, entry.note);
        liveRef.current.onDiag(entry);
      }
      lastKeyAtRef.current = e.timeStamp;

      // The code's characters typed into whatever holds focus; strip exactly
      // them back out before executing. Cursor focus never diverts a scan.
      if (emit) {
        clearAutoFire();
        if (consumedLength) removeFromActiveEditable(consumedLength);
        liveRef.current.onScan(emit);
      } else {
        scheduleAutoFire();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      clearAutoFire();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [active, wedgeConfig]);
}
