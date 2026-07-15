import { useCallback, useEffect, useRef } from 'react';
import type { LTEscalationRecord } from '../../api/types';

// ---------------------------------------------------------------------------
// postMessage protocol types
// ---------------------------------------------------------------------------

/** Messages sent from the parent to the iframe. */
type ParentMessage =
  | { type: 'lt:init'; escalation: IframeEscalationData; schema: Record<string, unknown> }
  | { type: 'lt:requestSubmit' }
  | { type: 'lt:validate' };

/** Messages received from the iframe. */
type ChildMessage =
  | { type: 'lt:ready' }
  | { type: 'lt:submit'; payload: Record<string, unknown> }
  | { type: 'lt:escalate'; target: string }
  | { type: 'lt:resize'; height: number };

/**
 * Escalation context delivered to the iframe via `lt:init`. Includes the
 * full envelope and metadata so the embedded app has all the context it
 * needs to load the right session and submit a meaningful payload back.
 *
 * The iframe is origin-validated before any message is sent, so secrets in
 * the envelope only travel to the declared src origin.
 */
interface IframeEscalationData {
  id: string;
  type: string;
  subtype: string;
  description: string | null;
  status: string;
  priority: number;
  role: string;
  workflow_type: string | null;
  envelope: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  escalation_payload: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface IframeViewportProps {
  src: string;
  escalation: LTEscalationRecord;
  schema: Record<string, unknown>;
  onResolve: (payload: Record<string, unknown>) => void;
  onEscalate: (targetRole: string) => void;
  submitAttempted?: boolean;
  /** Fill the parent container edge-to-edge (absolute inset-0). Used for full-bleed iframe mode. */
  fill?: boolean;
}

function safeParse(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

/**
 * Renders a sandboxed iframe for fully custom HITL UIs.
 *
 * Protocol — parent → iframe:
 *   `lt:init`         escalation context (id, envelope, metadata, payload) + schema
 *   `lt:requestSubmit` ask the iframe to trigger its own submit flow
 *   `lt:validate`     ask the iframe to report validation errors
 *
 * Protocol — iframe → parent:
 *   `lt:ready`    iframe loaded, ready to receive `lt:init`
 *   `lt:submit`   work complete; payload becomes the resolver payload
 *   `lt:escalate` re-route to a different role
 *   `lt:resize`   resize the iframe height
 *
 * The iframe can detect it is embedded via `window !== window.top` and
 * opt in to postMessage communication instead of its own submit UX.
 */
export function IframeViewport({ src, escalation, schema, onResolve, onEscalate, submitAttempted, fill }: IframeViewportProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeOrigin = useRef<string>('');

  // Parse the allowed origin from the src URL
  useEffect(() => {
    try {
      const url = new URL(src);
      iframeOrigin.current = url.origin;
    } catch {
      iframeOrigin.current = '';
    }
  }, [src]);

  const sendInit = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !iframeOrigin.current) return;

    const data: IframeEscalationData = {
      id: escalation.id,
      type: escalation.type,
      subtype: escalation.subtype,
      description: escalation.description,
      status: escalation.status,
      priority: escalation.priority,
      role: escalation.role,
      workflow_type: escalation.workflow_type,
      envelope: safeParse(escalation.envelope),
      metadata: escalation.metadata ?? null,
      escalation_payload: safeParse(escalation.escalation_payload),
    };

    const message: ParentMessage = { type: 'lt:init', escalation: data, schema };
    iframe.contentWindow.postMessage(message, iframeOrigin.current);
  }, [escalation, schema]);

  // Listen for messages from the iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== iframeOrigin.current) return;

      const data = event.data as ChildMessage;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

      switch (data.type) {
        case 'lt:ready':
          sendInit();
          break;
        case 'lt:submit':
          if (data.payload && typeof data.payload === 'object') {
            onResolve(data.payload);
          }
          break;
        case 'lt:escalate':
          if (typeof data.target === 'string' && data.target) {
            onEscalate(data.target);
          }
          break;
        case 'lt:resize': {
          const iframe = iframeRef.current;
          if (iframe && typeof data.height === 'number' && data.height > 0) {
            iframe.style.height = `${Math.min(data.height, 2000)}px`;
          }
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sendInit, onResolve, onEscalate]);

  // Forward lt:validate to iframe when the action bar triggers a submit attempt
  useEffect(() => {
    if (!submitAttempted) return;
    const iframe = iframeRef.current;
    if (iframe?.contentWindow && iframeOrigin.current) {
      iframe.contentWindow.postMessage({ type: 'lt:validate' } as ParentMessage, iframeOrigin.current);
    }
  }, [submitAttempted]);

  if (fill) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <iframe
          ref={iframeRef}
          src={src}
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads"
          className="w-full h-full border-0 block"
          title="HITL Viewport"
          onLoad={sendInit}
        />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-surface-border overflow-hidden bg-white">
      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads"
        className="w-full border-0"
        style={{ minHeight: '600px' }}
        title="HITL Viewport"
        onLoad={sendInit}
      />
    </div>
  );
}
