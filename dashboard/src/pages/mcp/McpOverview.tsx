import { Fragment, useMemo } from 'react';
import { useMcpServers } from '../../api/mcp';
import { StatCard } from '../../components/common/StatCard';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';

const FLOW_STEPS = [
  'Workflow starts',
  'Activities run',
  'Escalation created',
  'Human resolves',
  'Triage requested',
  'MCP tools called',
  'Workflow re-runs',
  'Result signaled',
];

export function McpOverview() {
  const { data, isLoading } = useMcpServers();
  const servers = data?.servers ?? [];

  const stats = useMemo(() => {
    const connected = servers.filter((s) => s.status === 'connected').length;
    const totalTools = servers.reduce((sum, s) => {
      if (Array.isArray(s.tool_manifest)) return sum + s.tool_manifest.length;
      return sum;
    }, 0);
    return { total: servers.length, connected, totalTools };
  }, [servers]);

  return (
    <div>
      <PageHeader title="MCP Dashboard" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        <StatCard
          label="Connected Servers"
          value={isLoading ? '—' : stats.connected}
          dotClass="bg-status-success"
        />
        <StatCard
          label="Available Tools"
          value={isLoading ? '—' : stats.totalTools}
          dotClass="bg-status-active"
        />
        <StatCard
          label="Registered Servers"
          value={isLoading ? '—' : stats.total}
        />
      </div>

      <div className="space-y-8 max-w-3xl">
        <div>
          <SectionLabel className="mb-3">How It Works</SectionLabel>
          <p className="text-sm text-text-secondary leading-relaxed">
            Every workflow is durable. Activities are checkpointed, retried on failure,
            and fully auditable. MCP servers register tools that become proxy
            activities — callable from any workflow with the same guarantees. Connect
            a server, and its tools are immediately available as durable activity calls.
          </p>
        </div>

        <div>
          <SectionLabel className="mb-3">Data Flow</SectionLabel>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            {FLOW_STEPS.map((step, i) => (
              <Fragment key={step}>
                <span className="px-3 py-1.5 bg-surface-sunken rounded text-text-primary">
                  {step}
                </span>
                {i < FLOW_STEPS.length - 1 && (
                  <span className="text-text-tertiary">&rarr;</span>
                )}
              </Fragment>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel className="mb-3">Authoring Workflows</SectionLabel>
          <p className="text-sm text-text-secondary leading-relaxed mb-3">
            A workflow is a function. Activities are its side effects — database calls,
            API requests, file processing. Wrap any function as a proxy activity and it
            gets automatic checkpointing and retry. MCP tools work the same way: each
            tool on a connected server is a proxy activity you can call from your
            workflow code.
          </p>
          <div className="bg-surface-sunken rounded-lg p-4 font-mono text-xs text-text-secondary leading-relaxed">
            <div className="text-text-tertiary">// 1. Define activities (or use MCP tools)</div>
            <div>const {'{ analyze, translate }'} = proxyActivities(serverTools);</div>
            <div className="mt-2 text-text-tertiary">// 2. Call them in your workflow</div>
            <div>const result = await analyze({'{ doc: input.ref }'});</div>
            <div>if (result.language !== 'en')</div>
            <div>{'  '}await translate({'{ content: result.text, target: "en" }'});</div>
          </div>
        </div>

        <div>
          <SectionLabel className="mb-3">Adding Tools</SectionLabel>
          <p className="text-sm text-text-secondary leading-relaxed">
            Register an MCP server under{' '}
            <span className="font-mono text-text-primary">Servers</span>, connect it,
            and its tools appear under{' '}
            <span className="font-mono text-text-primary">Tools</span>. Each tool
            lists its parameters and can be tested directly from the dashboard. In your
            workflow code, call them the same way you call any other activity.
          </p>
        </div>
      </div>
    </div>
  );
}
