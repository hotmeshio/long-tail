import { useState } from 'react';

import { Collapsible } from '../../../components/common/layout/Collapsible';
import { useStreamMessages, type StreamMessage } from '../../../api/stream-messages';
import { StreamMessageDetail } from '../../admin/streams/StreamMessageDetail';
import type { WorkflowExecutionEvent } from '../../../api/types';

/**
 * How a timeline activity maps to an underlying stream row. Two encodings:
 *
 * - `path` — the raw DAG view exposes the full dimension path, e.g.
 *   `0/0/0/worker` → aid `worker`, dad `,0,0,0`. Maps to one exact row by
 *   jid+aid+dad (engine control flow matched on payload metadata instead).
 * - `proxyIndex` — the durable view abstracts the replaying workflow into an
 *   ordered list of proxyActivity calls and uses an ordinal token (`-proxy-3-`).
 *   The Nth call is the Nth `proxyer` stream row ordered by `created`.
 */
export type StreamRef =
  | { kind: 'path'; aid: string; dad: string }
  | { kind: 'proxyIndex'; index: number };

export function parseTimelineKey(timelineKey: string | undefined): StreamRef | null {
  if (!timelineKey) return null;
  const proxy = /^-proxy-(\d+)-$/.exec(timelineKey);
  if (proxy) return { kind: 'proxyIndex', index: parseInt(proxy[1], 10) };
  if (timelineKey.startsWith('-')) return null; // other friendly tokens — unmappable
  const segments = timelineKey.split('/');
  if (segments.length < 2) return null;
  return { kind: 'path', aid: segments[segments.length - 1], dad: `,${segments.slice(0, -1).join(',')}` };
}

/** The aid/dad recorded inside a stream message's JSONB metadata. */
function metaOf(msg: StreamMessage): { aid?: string; dad?: string } {
  try {
    const parsed = JSON.parse(msg.message) as { metadata?: { aid?: string; dad?: string } };
    return { aid: parsed?.metadata?.aid, dad: parsed?.metadata?.dad };
  } catch {
    return {};
  }
}

interface RawStreamSectionProps {
  /** The job id (workflowId) — the `jid` on the underlying stream rows. */
  jid: string;
  /** HotMesh namespace / DB schema (e.g. `durable`). */
  appId: string;
  event: WorkflowExecutionEvent;
}

/**
 * Drill-down from a timeline activity to the underlying stream row(s) — the real
 * audit record — shown inline as JSON. Resolves the row from the activity's
 * timeline key for both the raw DAG view (exact jid+aid+dad) and the durable
 * view (Nth proxyActivity by created). Fetches only once expanded.
 */
export function RawStreamSection({ jid, appId, event }: RawStreamSectionProps) {
  const [open, setOpen] = useState(false);
  const ref = parseTimelineKey(event.attributes.timeline_key);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <span className={`transition-transform duration-300 ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        Raw stream message (audit)
      </button>
      <Collapsible open={open}>
        {open && (
          <div className="pt-1">
            {!ref && <p className="text-[11px] text-text-tertiary">No raw stream row maps to this activity.</p>}
            {ref?.kind === 'proxyIndex' && <ProxyBody namespace={appId || 'durable'} jid={jid} index={ref.index} />}
            {ref?.kind === 'path' && <PathBody namespace={appId || 'durable'} jid={jid} aid={ref.aid} dad={ref.dad} />}
          </div>
        )}
      </Collapsible>
    </div>
  );
}

/** Durable view: the Nth proxyActivity → the Nth `proxyer` row by created order. */
function ProxyBody({ namespace, jid, index }: { namespace: string; jid: string; index: number }) {
  const q = useStreamMessages({
    namespace, source: 'worker', jid, aid: 'proxyer',
    sort_by: 'created_at', order: 'asc', offset: index - 1, limit: 1,
  });
  const msg = q.data?.messages?.[0];

  if (q.isLoading) return <Loading />;
  if (q.error) return <LoadError />;
  if (!msg) return <NotFound label={`proxy activity #${index}`} />;
  return (
    <Record note={`Proxy activity #${index} (durable) — the worker stream record for this step`} messages={[msg]} />
  );
}

/** Raw DAG view: exact jid+aid+dad worker row, or engine control flow by metadata. */
function PathBody({ namespace, jid, aid, dad }: { namespace: string; jid: string; aid: string; dad: string }) {
  const worker = useStreamMessages({ namespace, source: 'worker', jid, aid, dad, limit: 1 });
  const workerMsg = worker.data?.messages?.[0];

  // engine_streams has no aid/dad columns — fetch this job's engine rows and
  // match on payload metadata. A control point can recur (one per cycle), so
  // all matches are shown. Runs only after a worker miss.
  const tryEngine = worker.isFetched && !workerMsg;
  const engine = useStreamMessages({ namespace, source: 'engine', jid, limit: 200 }, { enabled: tryEngine });
  const engineMatches = tryEngine
    ? (engine.data?.messages ?? []).filter((m) => { const x = metaOf(m); return x.aid === aid && x.dad === dad; })
    : [];

  const isWorker = !!workerMsg;
  const messages = workerMsg ? [workerMsg] : engineMatches;

  if (worker.isLoading || (tryEngine && engine.isLoading)) return <Loading />;
  if (worker.error) return <LoadError />;
  if (messages.length === 0) return <NotFound label={`${aid} ${dad}`} />;

  return (
    <Record
      note={isWorker
        ? 'Worker stream — the function-execution record behind this activity'
        : `Engine stream — control-flow record${messages.length > 1 ? `s (${messages.length}, one per occurrence)` : ' (trigger / hook / cycle)'}`}
      messages={messages}
    />
  );
}

function Record({ note, messages }: { note: string; messages: StreamMessage[] }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-text-tertiary">{note}</p>
      {messages.map((m) => (
        <div key={m.id} className="rounded-md bg-surface p-3">
          <StreamMessageDetail message={m} />
        </div>
      ))}
    </div>
  );
}

const Loading = () => <p className="text-[11px] text-text-tertiary">Loading stream message…</p>;
const LoadError = () => <p className="text-[11px] text-status-error">Failed to load stream message.</p>;
const NotFound = ({ label }: { label: string }) => (
  <p className="text-[11px] text-text-tertiary">No stream row found for <span className="font-mono">{label}</span>.</p>
);
