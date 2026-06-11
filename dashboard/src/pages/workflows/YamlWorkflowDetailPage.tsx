import { useParams, useNavigate } from 'react-router-dom';
import {
  Workflow, Braces, Info, FileCode2, History, Play, BookOpen,
} from 'lucide-react';
import yaml from 'js-yaml';
import { useYamlWorkflow, useYamlWorkflowVersions } from '../../api/yaml-workflows';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { NamespacePill } from '../../components/common/display/NamespacePill';
import { Pill } from '../../components/common/display/Pill';

// ── Helpers ───────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, color, children }: { icon: React.ElementType; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-surface-border">
      <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.5} />
      <h2 className="text-xs font-semibold uppercase tracking-widest text-accent/80">{children}</h2>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-[11px] text-text-quaternary py-2">{text}</p>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-2 gap-4">
      <span className="text-[10px] uppercase tracking-widest text-text-quaternary shrink-0">{label}</span>
      <span className="text-xs text-text-primary text-right min-w-0 truncate">{children}</span>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function schemaFields(schema: Record<string, unknown> | undefined | null): Array<{ key: string; type: string; description: string }> {
  const props = (schema as any)?.properties ?? {};
  return Object.entries(props).map(([key, v]: [string, any]) => ({
    key,
    type: v?.type ?? 'any',
    description: v?.description ?? '',
  }));
}

function FieldList({ schema, empty }: { schema: Record<string, unknown> | undefined | null; empty: string }) {
  const fields = schemaFields(schema);
  if (fields.length === 0) return <EmptyHint text={empty} />;
  return (
    <div className="divide-y divide-surface-border/30">
      {fields.map((f) => (
        <div key={f.key} className="py-2">
          <div className="flex items-baseline gap-2">
            <code className="text-xs font-mono text-text-primary">{f.key}</code>
            <span className="text-[10px] font-mono text-text-quaternary">{f.type}</span>
          </div>
          {f.description && <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">{f.description}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Page: Graph flow detail ─────────────────────────────────────────────────

export function YamlWorkflowDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: flow, isLoading } = useYamlWorkflow(id);
  const { data: versionsData } = useYamlWorkflowVersions(id);
  const versions = versionsData?.versions ?? [];

  if (isLoading || !flow) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-64" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  const manifest = flow.activity_manifest ?? [];

  // output_schema may be {} for flows created before the output_schema column was populated.
  // Fall back to parsing it from the stored YAML content.
  const outputSchema: Record<string, unknown> | undefined = (() => {
    const stored = flow.output_schema as any;
    if (stored && Object.keys(stored).length > 0) return stored;
    try {
      const parsed = yaml.load(flow.yaml_content) as any;
      return parsed?.app?.graphs?.[0]?.output?.schema ?? undefined;
    } catch {
      return undefined;
    }
  })();

  return (
    <div>
      {/* Hero */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-light text-text-primary font-mono">{flow.graph_topic}</h1>
          <button
            onClick={() => { window.location.hash = '#docs:dashboard.md:mcp-pipeline-tools'; }}
            className="text-text-quaternary hover:text-accent transition-colors mt-1"
            title="Docs"
          >
            <BookOpen className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          {flow.status === 'active' && (
            <button
              onClick={() => navigate(`/mcp/workflows/invoke?id=${flow.id}`)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors"
            >
              <Play className="w-3 h-3" /> Run
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <StatusBadge status={flow.status} />
        <NamespacePill namespace={flow.app_id} />
        <span className="text-[11px] font-mono text-text-quaternary">v{flow.content_version}</span>
      </div>

      {flow.description && (
        <p className="text-sm text-text-secondary mb-8 max-w-2xl leading-relaxed">{flow.description}</p>
      )}

      {flow.tags?.length > 0 && (
        <div className="flex items-center gap-1.5 mb-10">
          {flow.tags.map((t) => <Pill key={t}>{t}</Pill>)}
        </div>
      )}

      {/* Three columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-14 gap-y-10 mb-12">
        {/* Overview */}
        <div>
          <SectionHeader icon={Info} color="text-accent">Overview</SectionHeader>
          <div className="divide-y divide-surface-border/30">
            <Row label="Topic"><code className="font-mono">{flow.graph_topic}</code></Row>
            <Row label="Namespace"><code className="font-mono">{flow.app_id}</code></Row>
            <Row label="App version">{flow.app_version}</Row>
            <Row label="Runs as">{flow.execute_as || 'caller'}</Row>
            <Row label="Deployed">{formatDate(flow.deployed_at)}</Row>
            <Row label="Activated">{formatDate(flow.activated_at)}</Row>
          </div>
        </div>

        {/* Input / Output */}
        <div className="space-y-10">
          <div>
            <SectionHeader icon={Braces} color="text-emerald-400">Input</SectionHeader>
            <FieldList schema={flow.input_schema} empty="No declared input fields" />
          </div>
          <div>
            <SectionHeader icon={Braces} color="text-amber-400">Output</SectionHeader>
            <FieldList schema={outputSchema} empty="No declared output fields" />
          </div>
        </div>

        {/* Graph structure */}
        <div>
          <SectionHeader icon={Workflow} color="text-violet-400">Graph</SectionHeader>
          {manifest.length === 0 ? (
            <EmptyHint text="A single trigger maps the input straight to the output — see the YAML below." />
          ) : (
            <div className="divide-y divide-surface-border/30">
              {manifest.map((a) => (
                <div key={a.activity_id} className="flex items-center justify-between py-2 gap-3">
                  <div className="min-w-0">
                    <code className="text-xs font-mono text-text-primary">{a.title || a.activity_id}</code>
                    {a.topic && <p className="text-[10px] font-mono text-text-quaternary truncate">{a.topic}</p>}
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-text-quaternary shrink-0">{a.tool_source || a.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* YAML */}
      <div className="mb-12">
        <SectionHeader icon={FileCode2} color="text-cyan-400">YAML</SectionHeader>
        <pre className="text-[11px] font-mono text-text-secondary bg-surface-sunken/50 rounded-md p-4 overflow-x-auto leading-relaxed">
          {flow.yaml_content}
        </pre>
      </div>

      {/* Versions */}
      <div>
        <SectionHeader icon={History} color="text-rose-400">Versions ({versions.length})</SectionHeader>
        {versions.length === 0 ? (
          <EmptyHint text="No prior versions" />
        ) : (
          <div className="divide-y divide-surface-border/30">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-text-primary">v{v.version}</span>
                  {v.change_summary && <span className="text-[11px] text-text-tertiary truncate">{v.change_summary}</span>}
                </div>
                <span className="text-[10px] text-text-quaternary shrink-0">{formatDate(v.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
