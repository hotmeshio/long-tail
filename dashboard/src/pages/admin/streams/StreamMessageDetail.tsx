import { Filter } from 'lucide-react';
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

/** A field value that can be clicked to filter the master list. */
function FilterableField({ label, value, onFilter }: {
  label: string;
  value: string | null | undefined;
  onFilter?: (value: string) => void;
}) {
  if (!value) return null;
  return (
    <div>
      <span className="text-text-tertiary">{label}</span>
      <button
        onClick={() => onFilter?.(value)}
        className="flex items-center gap-1 group text-left w-full"
        title={`Filter by ${label.toLowerCase()}: ${value}`}
      >
        <p className="text-xs text-text-primary font-mono break-all group-hover:text-accent transition-colors">{value}</p>
        <Filter className="w-2.5 h-2.5 shrink-0 text-text-quaternary opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    </div>
  );
}

export interface StreamMessageDetailFilters {
  onFilterStatus?: (value: string) => void;
  onFilterStreamName?: (value: string) => void;
  onFilterMsgType?: (value: string) => void;
  onFilterTopic?: (value: string) => void;
  onFilterWorkflow?: (value: string) => void;
  onFilterJid?: (value: string) => void;
  onFilterAid?: (value: string) => void;
}

/**
 * Standard stream message detail view.
 *
 * This component is the canonical representation of a stream message.
 * Reuse it wherever stream messages need to be displayed — the layout,
 * timestamp formatting (via DateValue with ms/UTC/local tooltip), and
 * payload viewer are the standard.
 */
export function StreamMessageDetail({ message, filters }: {
  message: StreamMessage | null;
  filters?: StreamMessageDetailFilters;
}) {
  if (!message) return null;

  return (
    <div className="space-y-5 text-[11px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[message.status]}`} />
          <FilterableField
            label=""
            value={STATUS_LABEL[message.status]}
            onFilter={() => filters?.onFilterStatus?.(message.status)}
          />
          <span className={SOURCE_BADGE}>{message.source}</span>
        </div>
        <FilterableField
          label=""
          value={message.stream_name}
          onFilter={() => filters?.onFilterStreamName?.(message.stream_name)}
        />
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

      {/* Job ID — available on both engine and worker streams */}
      {message.jid && (
        <div className="space-y-2">
          <SectionLabel>Job</SectionLabel>
          <div className="grid grid-cols-1 gap-2">
            <FilterableField label="Job ID" value={message.jid} onFilter={filters?.onFilterJid} />
          </div>
        </div>
      )}

      {/* Worker-specific fields — clickable to filter */}
      {message.source === 'worker' && (
        <div className="space-y-2">
          <SectionLabel>Worker Details</SectionLabel>
          <div className="grid grid-cols-1 gap-2">
            <FilterableField label="Workflow" value={message.workflow_name} onFilter={filters?.onFilterWorkflow} />
            <FilterableField label="Activity" value={message.aid} onFilter={filters?.onFilterAid} />
            <Field label="Dimension" value={message.dad} />
            <FilterableField label="Type" value={message.msg_type} onFilter={filters?.onFilterMsgType} />
            <FilterableField label="Topic" value={message.topic} onFilter={filters?.onFilterTopic} />
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
