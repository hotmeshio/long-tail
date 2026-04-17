import { useState, useEffect, useRef, useCallback, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Phase = 'entering' | 'open' | 'exiting';

const DURATION = 280;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const PAD = 40;

interface FullscreenOverlayProps {
  open: boolean;
  onClose: () => void;
  sourceRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

function computeTransform(rect: DOMRect | null): string {
  if (!rect) return 'scale(0.92)';
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = vw - PAD * 2;
  const th = vh - PAD * 2;
  const sx = rect.width / tw;
  const sy = rect.height / th;
  const dx = (rect.left + rect.width / 2) - (PAD + tw / 2);
  const dy = (rect.top + rect.height / 2) - (PAD + th / 2);
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

export function FullscreenOverlay({ open, onClose, sourceRef, children }: FullscreenOverlayProps) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const prevOpenRef = useRef(false);

  // Detect open → true: start enter animation
  // Detect open → false: start exit animation (don't unmount yet)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      rectRef.current = sourceRef?.current?.getBoundingClientRect() ?? null;
      setPhase('entering');
    } else if (!open && prevOpenRef.current && phase === 'open') {
      rectRef.current = sourceRef?.current?.getBoundingClientRect() ?? null;
      setPhase('exiting');
    }
    prevOpenRef.current = open;
  }, [open, sourceRef, phase]);

  // entering → open (double-rAF so browser paints the initial transform)
  useEffect(() => {
    if (phase !== 'entering') return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase('open'));
    });
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Lock scroll while visible
  useEffect(() => {
    if (!phase) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [phase]);

  // Esc key → tell parent to close (which triggers exit via open→false)
  useEffect(() => {
    if (!phase) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [phase, onClose]);

  // After exit animation finishes, unmount
  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName === 'transform' && phase === 'exiting') {
      setPhase(null);
    }
  }, [phase]);

  // Safety: if exiting but transition doesn't fire, force unmount
  useEffect(() => {
    if (phase !== 'exiting') return;
    const timer = setTimeout(() => setPhase(null), DURATION + 50);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!phase) return null;

  const collapsed = phase === 'entering' || phase === 'exiting';
  const transform = collapsed ? computeTransform(rectRef.current) : 'none';
  const opacity = collapsed ? 0 : 1;

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-auto p-10"
      style={{
        transformOrigin: 'center center',
        transition: `transform ${DURATION}ms ${EASING}, opacity ${DURATION}ms ${EASING}`,
        transform,
        opacity,
        backgroundColor: '#FFFFFF',
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {children}
    </div>,
    document.body,
  );
}
