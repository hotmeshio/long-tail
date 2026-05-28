import { useCallback, useEffect, useRef } from 'react';
import type { LTEscalationRecord } from '../../api/types';

// ---------------------------------------------------------------------------
// postMessage protocol types
// ---------------------------------------------------------------------------

/** Messages sent from the parent to the iframe. */
type ParentMessage =
  | { type: 'lt:init'; escalation: IframeEscalationData; schema: Record<string, unknown> }
  | { type: 'lt:requestSubmit' };

/** Messages received from the iframe. */
type ChildMessage =
  | { type: 'lt:ready' }
  | { type: 'lt:submit'; payload: Record<string, unknown> }
  | { type: 'lt:escalate'; target: string }
  | { type: 'lt:resize'; height: number };

/** Safe subset of escalation data exposed to the iframe (no envelope). */
interface IframeEscalationData {
  id: string;
  type: string;
  subtype: string;
  description: string | null;
  status: string;
  priority: number;
  role: string;
  workflow_type: string | null;
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
}

/**
 * Renders a sandboxed iframe for fully custom HITL UIs.
 *
 * The iframe communicates with the parent via postMessage:
 * - Parent → iframe: `lt:init` (escalation data + schema)
 * - Iframe → parent: `lt:submit`, `lt:escalate`, `lt:resize`
 *
 * Security:
 * - `sandbox` restricts iframe capabilities
 * - Origin validation on incoming messages
 * - Envelope data is NOT sent to the iframe (may contain secrets)
 */
export function IframeViewport({ src, escalation, schema, onResolve, onEscalate }: IframeViewportProps) {
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

    const safeData: IframeEscalationData = {
      id: escalation.id,
      type: escalation.type,
      subtype: escalation.subtype,
      description: escalation.description,
      status: escalation.status,
      priority: escalation.priority,
      role: escalation.role,
      workflow_type: escalation.workflow_type,
    };

    const message: ParentMessage = {
      type: 'lt:init',
      escalation: safeData,
      schema,
    };

    iframe.contentWindow.postMessage(message, iframeOrigin.current);
  }, [escalation, schema]);

  // Listen for messages from the iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Origin validation
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

  return (
    <div className="rounded-md border border-surface-border overflow-hidden bg-white">
      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-forms"
        className="w-full border-0"
        style={{ minHeight: '400px' }}
        title="HITL Viewport"
        onLoad={sendInit}
      />
    </div>
  );
}
