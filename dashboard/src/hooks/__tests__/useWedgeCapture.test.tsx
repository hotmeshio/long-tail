import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWedgeCapture } from '../useWedgeCapture';
import { WEDGE_DEFAULTS } from '../../lib/scan-sources/keyboard-wedge';
import { SCAN_CAPTURE_ATTR, SCAN_CAPTURE_OFF } from '../../lib/scan-sources/types';

const CODE = '812999000011';

/** Keydowns at scanner speed (10ms apart), dispatched on the target so they pass the window's capture phase. */
function typeAtScannerSpeed(target: HTMLElement, text: string, startMs = 1000): number {
  let t = startMs;
  for (const key of text) {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'timeStamp', { value: t });
    target.dispatchEvent(e);
    t += 10;
  }
  return t;
}

function pressEnter(target: HTMLElement, atMs: number): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  Object.defineProperty(e, 'timeStamp', { value: atMs });
  target.dispatchEvent(e);
  return e;
}

function mountInput(keepsKeys: boolean): HTMLInputElement {
  const wrap = document.createElement('span');
  if (keepsKeys) wrap.setAttribute(SCAN_CAPTURE_ATTR, SCAN_CAPTURE_OFF);
  const input = document.createElement('input');
  input.type = 'text';
  wrap.appendChild(input);
  document.body.appendChild(wrap);
  input.focus();
  return input;
}

describe('useWedgeCapture', () => {
  let onScan: ReturnType<typeof vi.fn<(code: string) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    onScan = vi.fn<(code: string) => void>();
    renderHook(() => useWedgeCapture({
      active: true, wedgeConfig: WEDGE_DEFAULTS, diagnosticsOn: false, onScan, onDiag: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('captures a scanner-paced code with Enter in an ordinary field', () => {
    const input = mountInput(false);
    const enter = pressEnter(input, typeAtScannerSpeed(input, CODE));
    expect(onScan).toHaveBeenCalledWith(CODE);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('captures a scanner-paced code with no suffix after the quiet period', () => {
    const input = mountInput(false);
    typeAtScannerSpeed(input, CODE);
    vi.advanceTimersByTime(WEDGE_DEFAULTS.autoFireQuietMs);
    expect(onScan).toHaveBeenCalledWith(CODE);
  });

  it('leaves a code with Enter to a field that keeps its keys', () => {
    const input = mountInput(true);
    const enter = pressEnter(input, typeAtScannerSpeed(input, CODE));
    vi.advanceTimersByTime(WEDGE_DEFAULTS.autoFireQuietMs * 2);
    expect(onScan).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it('runs no quiet-period scan for a code typed into a field that keeps its keys', () => {
    const input = mountInput(true);
    typeAtScannerSpeed(input, CODE);
    vi.advanceTimersByTime(WEDGE_DEFAULTS.autoFireQuietMs * 2);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('drops keys gathered elsewhere once a key lands in a field that keeps its keys', () => {
    const outside = mountInput(false);
    const t = typeAtScannerSpeed(outside, CODE.slice(0, 6));
    const keyIn = mountInput(true);
    const t2 = typeAtScannerSpeed(keyIn, CODE.slice(6), t);
    pressEnter(outside, t2);
    vi.advanceTimersByTime(WEDGE_DEFAULTS.autoFireQuietMs * 2);
    expect(onScan).not.toHaveBeenCalled();
  });
});
