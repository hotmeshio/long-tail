import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProcessLane } from './helpers';

export interface BarAnim {
  width: number;
  opacity: number;
}

export function useTimelineAnimation(
  laneCount: number,
  timeMin: number,
  timeMax: number,
  durationMs = 500,
) {
  const [progress, setProgress] = useState(0); // 0 → 1
  const startRef = useRef<number | null>(null);
  const totalSpanMs = timeMax - timeMin || 1;

  useEffect(() => {
    if (laneCount === 0) return;
    startRef.current = null;
    setProgress(0);

    let raf: number;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(elapsed / durationMs, 1);
      // ease-out cubic for a smooth deceleration
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [laneCount, durationMs]);

  const animatedBar = useCallback(
    (lane: ProcessLane): BarAnim => {
      const appearAt = (lane.startMs - timeMin) / totalSpanMs;
      const doneAt = (lane.endMs - timeMin) / totalSpanMs;

      if (progress < appearAt) {
        return { width: 0, opacity: 0 };
      }

      const laneSpan = doneAt - appearAt || 0.001;
      const fill = Math.min((progress - appearAt) / laneSpan, 1);
      const animatedWidth = lane.widthPct * fill;
      const fadeIn = Math.min(fill / 0.1, 1);

      return { width: animatedWidth, opacity: fadeIn };
    },
    [progress, timeMin, totalSpanMs],
  );

  return { progress, animatedBar };
}
