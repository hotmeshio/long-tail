import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import type { LineIndexRow } from '../../api/machines';
import type { Column } from '../../components/common/data/DataTable';
import { formatDateTime } from '../../lib/format';
import { LINE_TONE_DOT, LINE_TONE_LABEL, lineTone } from './line-index';

export function linePath(row: Pick<LineIndexRow, 'siteId' | 'lineId'>): string {
  return `/lines/${encodeURIComponent(row.siteId)}/${encodeURIComponent(row.lineId)}`;
}

function Count({ value, tone, title }: { value: number; tone?: string; title?: string }) {
  return (
    <span className={`tabular-nums ${value > 0 ? tone ?? 'text-text-primary' : 'text-text-quaternary'}`} title={title}>
      {value}
    </span>
  );
}

/** The index columns; `onEdit` adds the manage column for those who may declare. */
export function lineColumns(onEdit: ((row: LineIndexRow) => void) | null): Column<LineIndexRow>[] {
  const columns: Column<LineIndexRow>[] = [
    {
      key: 'line',
      label: 'Line',
      priority: 1,
      render: (row) => {
        const tone = lineTone(row);
        return (
          <span className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full dot-ring shrink-0 ${LINE_TONE_DOT[tone]}`} title={LINE_TONE_LABEL[tone]} />
            <Link to={linePath(row)} className="text-xs font-mono text-accent hover:underline truncate" title={`${row.siteId} · ${row.lineId}`}>
              {row.siteId} · {row.lineId}
            </Link>
          </span>
        );
      },
    },
    {
      key: 'machines',
      label: 'Machines',
      className: 'w-28',
      render: (row) => (
        <span className="text-2xs tabular-nums">
          <span className="text-text-primary">{row.health.machines}</span>
          {row.health.offline > 0 && <span className="text-status-warning"> · {row.health.offline} offline</span>}
          {row.health.quiet > 0 && <span className="text-status-warning"> · {row.health.quiet} quiet</span>}
        </span>
      ),
    },
    {
      key: 'alarms',
      label: 'Alarms',
      className: 'w-16 text-right',
      render: (row) => <Count value={row.health.alarms} tone="text-status-warning" title="Active alarms" />,
    },
    {
      key: 'people',
      label: 'People',
      className: 'w-16 text-right',
      render: (row) => <Count value={row.health.people} tone="text-status-warning" title="Rows waiting on a person" />,
    },
    {
      key: 'inflight',
      label: 'In flight',
      className: 'w-20 text-right',
      render: (row) => <Count value={row.health.handoff + row.health.command} title="Open handoff and command rows" />,
    },
    {
      key: 'led',
      label: 'Led',
      className: 'w-20',
      render: (row) => (
        <span className={`text-2xs ${row.leading ? 'text-text-primary' : 'text-text-tertiary'}`}>{row.leading ? 'here' : 'elsewhere'}</span>
      ),
    },
    {
      key: 'chain',
      label: 'Chain',
      showFrom: 'wall',
      priority: 3,
      render: (row) => (
        <span className="text-2xs font-mono text-text-tertiary truncate block" title={row.machines.map((m) => m.machineId).join(' → ')}>
          {row.machines.map((m) => m.machineId).join(' → ')}
        </span>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      showFrom: 'wall',
      className: 'w-28',
      priority: 3,
      render: (row) => (
        <span className="text-2xs text-text-tertiary tabular-nums" title={`changed ${formatDateTime(row.updatedAt)}`}>
          {row.source} · v{row.version}
        </span>
      ),
    },
  ];
  if (onEdit) {
    columns.push({
      key: 'manage',
      label: '',
      className: 'w-10',
      priority: 1,
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(row);
          }}
          className="icon-link"
          title={`Edit ${row.siteId} · ${row.lineId}`}
          aria-label={`Edit ${row.siteId} · ${row.lineId}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      ),
    });
  }
  return columns;
}
