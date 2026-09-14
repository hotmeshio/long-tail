import type { LTEscalationRecord } from '../api/types';

export const VIEWPORT_STAGES = {
  /** Pending and not workable by the viewer: available, or claimed by someone else. */
  PENDING: 'pending',
  /** Pending and workable by the viewer: the editor stage. */
  CLAIMED: 'claimed',
  RESOLVED: 'resolved',
} as const;
export type ViewportStage = (typeof VIEWPORT_STAGES)[keyof typeof VIEWPORT_STAGES];

/** The `x-lt-viewport` declaration: `src` is the claimed (editor) URL. */
export interface XLtViewport {
  type: 'iframe';
  src: string;
  onPending?: string;
  onResolved?: string;
}

export function readViewport(schema: Record<string, unknown> | null | undefined): XLtViewport | null {
  const vp = schema?.['x-lt-viewport'] as Partial<XLtViewport> | undefined;
  if (vp?.type !== 'iframe' || typeof vp.src !== 'string' || !vp.src) return null;
  return vp as XLtViewport;
}

/** The stage an escalation is in for the viewer; null for cancelled rows. */
export function viewportStage(esc: LTEscalationRecord, editable: boolean): ViewportStage | null {
  if (esc.status === 'resolved') return VIEWPORT_STAGES.RESOLVED;
  if (esc.status !== 'pending') return null;
  return editable ? VIEWPORT_STAGES.CLAIMED : VIEWPORT_STAGES.PENDING;
}

/** The declared URL for a stage, or null when the declaration leaves that stage to the default surface. */
export function viewportSrcForStage(viewport: XLtViewport, stage: ViewportStage): string | null {
  if (stage === VIEWPORT_STAGES.CLAIMED) return viewport.src;
  if (stage === VIEWPORT_STAGES.PENDING) return viewport.onPending ?? null;
  return viewport.onResolved ?? null;
}

/**
 * Expands `{key}` tokens in a viewport URL from the escalation's sources,
 * merged so resolver_payload wins over escalation_payload, which wins over
 * envelope, which wins over metadata. Unmatched tokens stay in place.
 */
export function expandViewportSrc(src: string, esc: LTEscalationRecord): string {
  if (!src.includes('{')) return src;
  try {
    const parse = (s: string | null | undefined): Record<string, unknown> => {
      if (!s) return {};
      try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
    };
    const merged = {
      ...(esc.metadata ?? {}),
      ...parse(esc.envelope),
      ...parse(esc.escalation_payload),
      ...parse(esc.resolver_payload),
    };
    return src.replace(/\{([^}]+)\}/g, (_, key) =>
      Object.prototype.hasOwnProperty.call(merged, key) ? String(merged[key]) : `{${key}}`
    );
  } catch {
    return src;
  }
}
