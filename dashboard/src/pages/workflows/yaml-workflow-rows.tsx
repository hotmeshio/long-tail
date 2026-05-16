import { ChevronRight, Clock, Play, Wrench } from 'lucide-react';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { ToolPill } from '../../components/common/display/ToolPill';
import { ServerName } from '../../components/common/display/ServerName';
import type { ProcessServer } from './yaml-helpers';
import type { LTYamlWorkflowRecord } from '../../api/types';

// ── Tool row ────────────────────────────────────────────────────────────────

export function ToolRow({ wf, onTry, onCron }: {
  wf: LTYamlWorkflowRecord;
  onTry: () => void;
  onCron: () => void;
}) {
  const canTry = wf.status === 'active';
  const hasCron = !!wf.cron_schedule;

  return (
    <tr
      onClick={canTry ? onTry : undefined}
      className={`group/row hover:bg-surface-hover/50 transition-colors border-b border-surface-border/15 ${canTry ? 'cursor-pointer' : ''}`}
    >
      {/* Tool name + description */}
      <td className="pl-14 pr-6 py-2.5">
        <ToolPill name={wf.graph_topic} size="md" />
        {wf.description && (
          <p className="text-[11px] leading-snug text-text-quaternary mt-0.5">{wf.description}</p>
        )}
      </td>

      {/* Version */}
      <td className="px-4 py-2.5 w-20 text-[10px] text-text-quaternary font-mono whitespace-nowrap">
        v{wf.content_version}
      </td>

      {/* Status */}
      <td className="px-4 py-2.5 w-28 whitespace-nowrap">
        <StatusBadge status={wf.status} />
      </td>

      {/* Actions — hover reveal */}
      <td className="px-4 py-2.5 w-16">
        <div className="flex items-center justify-end gap-1.5">
          {canTry && (
            <button
              onClick={(e) => { e.stopPropagation(); onTry(); }}
              className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent"
              title="Test tool"
            >
              <Play className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onCron(); }}
            className={hasCron
              ? 'text-status-success'
              : 'opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent'}
            title={hasCron ? `Cron: ${wf.cron_schedule}` : 'Schedule cron'}
          >
            <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Server row ──────────────────────────────────────────────────────────────

export function ServerRow({
  server,
  expanded,
  onToggle,
  onTryTool,
  onWorkbench,
  onCron,
  visibleTools,
}: {
  server: ProcessServer;
  expanded: boolean;
  onToggle: () => void;
  onTryTool: (wf: LTYamlWorkflowRecord) => void;
  onWorkbench: () => void;
  onCron: (wf: LTYamlWorkflowRecord) => void;
  visibleTools: LTYamlWorkflowRecord[];
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="group/row border-b border-surface-border/50 transition-colors duration-100 cursor-pointer row-hover"
      >
        {/* Server name */}
        <td className="px-6 py-2.5">
          <div className="flex items-center gap-2">
            <span className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''} text-text-tertiary`}>
              <ChevronRight size={14} />
            </span>
            <span className="flex items-center gap-1.5">
              <ServerName name={server.appId} short={false} />
              <sup className="text-[9px] font-normal text-accent/70">{server.toolCount}</sup>
            </span>
          </div>
        </td>

        {/* Version */}
        <td className="px-4 py-2.5 text-[10px] text-text-quaternary font-mono whitespace-nowrap">
          v{server.appVersion}
        </td>

        {/* Status */}
        <td className="px-4 py-2.5 whitespace-nowrap">
          <StatusBadge status={server.status} />
        </td>

        {/* Actions */}
        <td className="px-4 py-2.5 w-16">
          <div className="flex items-center justify-end gap-1.5">
            {server.setId && (
              <button
                onClick={(e) => { e.stopPropagation(); onWorkbench(); }}
                className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent"
                title="Open workbench"
              >
                <Wrench className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && visibleTools.map((wf) => (
        <ToolRow key={wf.id} wf={wf} onTry={() => onTryTool(wf)} onCron={() => onCron(wf)} />
      ))}
    </>
  );
}
