import type { StreamMessage } from '../../../api/stream-messages';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { DateValue } from '../../../components/common/display/DateValue';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { STATUS_DOT, STATUS_LABEL, SOURCE_BADGE } from './constants';

function Timestamp({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-text-tertiary">{label}</span>
      <div className="mt-0.5">
        <DateValue date={value} format="datetime" />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-text-tertiary">{label}</span>
      <p className="text-xs text-text-primary font-mono break-all">{value}</p>
    </div>
  );
}

/**
 * Standard stream message detail view.
 *
 * This component is the canonical representation of a stream message.
 * Reuse it wherever stream messages need to be displayed — the layout,
 * timestamp formatting (via DateValue with ms/UTC/local tooltip), and
 * payload viewer are the standard.
 */
export function StreamMessageDetail({ message }: { message: StreamMessage | null }) {
  if (!message) return null;

  return (
    <div className="space-y-5 text-[11px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[message.status]}`} />
          <span className="text-xs font-medium text-text-primary">
            {STATUS_LABEL[message.status]}
          </span>
          <span className={SOURCE_BADGE}>{message.source}</span>
        </div>
        <p className="text-xs font-mono text-text-secondary break-all mt-1">{message.stream_name}</p>
        <p className="text-[10px] text-text-tertiary mt-0.5">ID: {message.id}</p>
      </div>

      {/* Timestamps */}
      <div className="space-y-2">
        <SectionLabel>Timestamps</SectionLabel>
        <div className="grid grid-cols-1 gap-2">
          <Timestamp label="Created" value={message.created_at} />
          <Timestamp label="Reserved" value={message.reserved_at} />
          <Timestamp label="Processed" value={message.expired_at} />
          <Timestamp label="Dead-lettered" value={message.dead_lettered_at} />
        </div>
      </div>

      {/* Metadata */}
      <div className="space-y-2">
        <SectionLabel>Metadata</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Priority" value={String(message.priority)} />
          <Field label="Retries" value={`${message.retry_attempt} / ${message.max_retry_attempts}`} />
          <Field label="Reserved by" value={message.reserved_by} />
        </div>
      </div>

      {/* Worker-specific fields */}
      {message.source === 'worker' && (
        <div className="space-y-2">
          <SectionLabel>Worker Details</SectionLabel>
          <div className="grid grid-cols-1 gap-2">
            <Field label="Workflow" value={message.workflow_name} />
            <Field label="Job ID" value={message.jid} />
            <Field label="Activity" value={message.aid} />
            <Field label="Dimension" value={message.dad} />
            <Field label="Type" value={message.msg_type} />
            <Field label="Topic" value={message.topic} />
          </div>
        </div>
      )}

      {/* Message payload — fully expanded by default */}
      <div className="space-y-2">
        <JsonViewer data={message.message} label="Payload" defaultCollapsed={false} />
      </div>
    </div>
  );
}
