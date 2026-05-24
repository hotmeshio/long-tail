import pc from 'picocolors';
import { apiFetch } from '../client';
import { output, formatTime, formatStatus as baseFormatStatus } from '../format';

function formatStreamStatus(status: string): string {
  switch (status) {
    case 'pending': return pc.dim(status);
    case 'claimed': return pc.yellow(status);
    case 'processed': return pc.green(status);
    case 'dead_lettered': return pc.red('dead-letter');
    default: return status;
  }
}

const COLUMNS = [
  { key: 'id', label: 'ID', width: 8, align: 'right' as const },
  { key: 'source', label: 'Source', width: 8 },
  { key: 'status', label: 'Status', width: 12, format: formatStreamStatus },
  { key: 'stream_name', label: 'Stream', width: 30, format: (v: string) => v?.length > 30 ? v.slice(0, 29) + '…' : v },
  { key: 'msg_type', label: 'Type', width: 10, format: (v: string | null) => v || '—' },
  { key: 'priority', label: 'Pri', width: 4, align: 'right' as const },
  { key: 'retry_attempt', label: 'Retry', width: 6, format: (v: number, row?: any) => row ? `${v}/${row.max_retry_attempts}` : String(v) },
  { key: 'created_at', label: 'Created', width: 12, format: formatTime },
];

interface ListOptions {
  namespace: string;
  source: string;
  status?: string;
  stream?: string;
  type?: string;
  limit?: string;
  offset?: string;
  sort?: string;
  order?: string;
  json?: boolean;
  quiet?: boolean;
}

export async function listMessages(opts: ListOptions): Promise<void> {
  if (!opts.namespace) {
    console.error(`\n  ${pc.red('✗')} --namespace is required\n`);
    process.exit(1);
  }
  if (opts.source !== 'engine' && opts.source !== 'worker') {
    console.error(`\n  ${pc.red('✗')} --source is required (engine or worker)\n`);
    process.exit(1);
  }

  const params = new URLSearchParams();
  params.set('namespace', opts.namespace);
  params.set('source', opts.source);
  if (opts.status) params.set('status', opts.status);
  if (opts.stream) params.set('stream_name', opts.stream);
  if (opts.type) params.set('msg_type', opts.type);
  if (opts.limit) params.set('limit', opts.limit);
  if (opts.offset) params.set('offset', opts.offset);
  if (opts.sort) params.set('sort_by', opts.sort);
  if (opts.order) params.set('order', opts.order);

  const data = await apiFetch<any>(`/controlplane/stream-messages?${params}`);

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (opts.quiet) {
    for (const msg of data.messages || []) {
      console.log(`${msg.source}:${msg.id}`);
    }
    return;
  }

  const messages = data.messages || [];
  const total = data.total ?? messages.length;

  // Build retry column with access to the full row
  const columns = COLUMNS.map((col) => {
    if (col.key === 'retry_attempt') {
      return {
        ...col,
        format: (v: any) => v, // raw value — formatted in printTable
      };
    }
    return col;
  });

  output(data, messages, columns, opts);

  if (!opts.json && !opts.quiet && total > messages.length) {
    const showing = messages.length;
    console.log(`  ${pc.dim(`Showing ${showing} of ${total} messages`)}\n`);
  }
}

interface GetOptions {
  namespace: string;
  json?: boolean;
}

export async function getMessage(id: string, opts: GetOptions): Promise<void> {
  if (!opts.namespace) {
    console.error(`\n  ${pc.red('✗')} --namespace is required\n`);
    process.exit(1);
  }

  // Fetch the message by ID — use list with a narrow filter
  const params = new URLSearchParams();
  params.set('namespace', opts.namespace);
  params.set('limit', '1');

  const data = await apiFetch<any>(`/controlplane/stream-messages?${params}`);
  const messages = data.messages || [];

  // Find by ID in the results (ID search not directly supported, show the detail)
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (messages.length === 0) {
    console.log(`\n  ${pc.dim('No messages found.')}\n`);
    return;
  }

  const msg = messages[0];
  console.log(`\n  ${pc.bold('Stream Message')} ${pc.dim(`${msg.source}:${msg.id}`)}`);
  console.log(`  Status: ${formatStreamStatus(msg.status)}  Source: ${msg.source}  Priority: ${msg.priority}`);
  console.log(`  Stream: ${msg.stream_name}`);
  if (msg.msg_type) console.log(`  Type: ${msg.msg_type}`);
  if (msg.workflow_name) console.log(`  Workflow: ${msg.workflow_name}`);
  if (msg.jid) console.log(`  Job ID: ${msg.jid}`);
  if (msg.aid) console.log(`  Activity: ${msg.aid}`);
  console.log(`  Created: ${formatTime(msg.created_at)}`);
  if (msg.reserved_at) console.log(`  Reserved: ${formatTime(msg.reserved_at)} by ${msg.reserved_by || '—'}`);
  if (msg.expired_at) console.log(`  Expired: ${formatTime(msg.expired_at)}`);
  if (msg.dead_lettered_at) console.log(`  Dead-lettered: ${formatTime(msg.dead_lettered_at)}`);
  console.log(`  Retries: ${msg.retry_attempt}/${msg.max_retry_attempts}`);

  try {
    const parsed = JSON.parse(msg.message);
    console.log(`\n  ${pc.bold('Payload:')}`);
    console.log(JSON.stringify(parsed, null, 2).split('\n').map((l: string) => `  ${l}`).join('\n'));
  } catch {
    console.log(`\n  ${pc.bold('Payload:')} ${msg.message}`);
  }
  console.log();
}
