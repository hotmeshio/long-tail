import { ChevronRight, Clock, Play, Wand2, Wrench } from 'lucide-react';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import type { ProcessServer } from './yaml-helpers';
import type { LTYamlWorkflowRecord } from '../../api/types';

// ── Tool row (individual workflow inside expanded server) ─────────────────────

export function ToolRow({ wf, onTry, onWizard, onCron }: {
  wf: LTYamlWorkflowRecord;
  onTry: () => void;
  onWizard: () => void;
  onCron: () => void;
}) {
  const canTry = wf.status === 'active';
  const hasCron = !!wf.cron_schedule;

  return (
    <div onClick={canTry ? onTry : undefined} className={`group/row flex items-center hover:bg-surface-hover/50 transition-colors border-b border-surface-border/30 ${canTry ? 'cursor-pointer' : ''}`}>
      <div className="flex-1 pl-14 pr-6 py-2 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-accent-primary truncate">{wf.graph_topic}</code>
          <span className="text-[9px] text-text-tertiary font-mono shrink-0">v{wf.content_version}</span>
        </div>
        {wf.description && (
          <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-1">{wf.description}</p>
        )}
      </div>
      <div className="w-32 px-4 py-2 text-[10px] text-text-tertiary whitespace-nowrap shrink-0">
        {new Date(wf.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </div>
      <div className="w-28 px-6 py-2 whitespace-nowrap shrink-0">
        <StatusBadge status={wf.status} />
      </div>
      <div className="w-20 px-3 py-2 flex justify-end gap-2 shrink-0">
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
        {wf.source_workflow_id && (
          <button
            onClick={(e) => { e.stopPropagation(); onWizard(); }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent"
            title="MCP Tool Compiler"
          >
            <Wand2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Server row (expandable namespace) ────────────────────────────────────────

export function ServerRow({
  server,
  expanded,
  onToggle,
  onTryTool,
  onWizard,
  onWorkbench,
  onCron,
  visibleTools,
}: {
  server: ProcessServer;
  expanded: boolean;
  onToggle: () => void;
  onTryTool: (wf: LTYamlWorkflowRecord) => void;
  onWizard: (wf: LTYamlWorkflowRecord) => void;
  onWorkbench: () => void;
  onCron: (wf: LTYamlWorkflowRecord) => void;
  visibleTools: LTYamlWorkflowRecord[];
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="group/row border-b transition-colors duration-100 cursor-pointer row-hover"
      >
        {/* Name + version */}
        <td className="px-6 py-3.5">
          <div className="flex items-center gap-2">
            <span className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''} text-text-tertiary`}>
              <ChevronRight size={14} />
            </span>
            <p className="text-sm text-text-primary font-medium font-mono">{server.appId}</p>
            <span className="text-[9px] text-text-tertiary font-mono">app v{server.appVersion}</span>
          </div>
        </td>

        {/* Status */}
        <td className="px-6 py-3.5 w-28 whitespace-nowrap">
          <StatusBadge status={server.status} />
        </td>

        {/* Tool count + workbench */}
        <td className="w-20 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-accent/30 text-[10px] font-medium text-accent">
              {server.toolCount}
            </span>
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

      {/* Expanded tool rows — no sub-header, aligned to outer columns */}
      <tr>
        <td colSpan={5} className="p-0 border-0">
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              {visibleTools.map((wf) => (
                <ToolRow key={wf.id} wf={wf} onTry={() => onTryTool(wf)} onWizard={() => onWizard(wf)} onCron={() => onCron(wf)} />
              ))}
              <div className="h-1 bg-surface-sunken/20" />
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}
