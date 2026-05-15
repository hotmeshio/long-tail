import { useState, useMemo } from 'react';
import {
  Search, Play,
  MessageSquare, Eye, Database, Cog, Code2, Shield, BookOpen,
  LayoutGrid, Image,
} from 'lucide-react';
import { useCapabilities, type CapabilityTool } from '../../api/capabilities';
import { ToolTestPanel } from '../../components/common/test/ToolTestPanel';
import { ToolPill } from '../../components/common/display/ToolPill';
import { ServerName } from '../../components/common/display/ServerName';
import { PageHeader } from '../../components/common/layout/PageHeader';
import type { LucideIcon } from 'lucide-react';

// ── Category icons + colors ─────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: LucideIcon; color: string }> = {
  Communication: { icon: MessageSquare, color: 'text-blue-400' },
  Analysis:      { icon: Eye,            color: 'text-violet-400' },
  Media:         { icon: Image,          color: 'text-pink-400' },
  Data:          { icon: Database,       color: 'text-emerald-400' },
  Automation:    { icon: Cog,            color: 'text-amber-400' },
  Development:   { icon: Code2,          color: 'text-cyan-400' },
  System:        { icon: Shield,         color: 'text-red-400' },
  Reference:     { icon: BookOpen,       color: 'text-text-tertiary' },
  Other:         { icon: LayoutGrid,     color: 'text-text-tertiary' },
};

// ── Page ─────────────────────────────────────────────────────────────────────

export function CapabilitiesPage() {
  const { data, isLoading } = useCapabilities();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [tryTool, setTryTool] = useState<{
    serverId: string;
    serverName: string;
    tool: { name: string; description: string; inputSchema: Record<string, any> };
  } | null>(null);

  const categories = data?.categories ?? [];
  const totalTools = data?.totalTools ?? 0;

  // Filter by active category + search term
  const filtered = useMemo(() => {
    let cats = categories;
    if (activeCategory) {
      cats = cats.filter((c) => c.name === activeCategory);
    }
    if (!search.trim()) return cats;
    const q = search.toLowerCase();
    return cats
      .map((cat) => ({
        ...cat,
        tools: cat.tools.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.serverName.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.tools.length > 0);
  }, [categories, search, activeCategory]);

  return (
    <div>
      <PageHeader title="Capabilities" />

      {/* Filter row: category icons + search */}
      {!isLoading && categories.length > 0 && (
        <div className="flex items-center gap-5 mb-10">
          <button
            onClick={() => setActiveCategory(null)}
            className={`flex flex-col items-center gap-1 transition-colors ${
              activeCategory === null ? 'text-accent' : 'text-text-quaternary hover:text-text-secondary'
            }`}
          >
            <LayoutGrid className="w-5 h-5" strokeWidth={1.5} />
            <span className="text-[9px] font-medium">All</span>
          </button>
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat.name] ?? CATEGORY_META.Other;
            const Icon = meta.icon;
            const isActive = activeCategory === cat.name;
            return (
              <button
                key={cat.name}
                onClick={() => setActiveCategory(isActive ? null : cat.name)}
                className={`flex flex-col items-center gap-1 transition-colors ${
                  isActive ? meta.color : 'text-text-quaternary hover:text-text-secondary'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={1.5} />
                <span className="text-[9px] font-medium">{cat.name}</span>
              </button>
            );
          })}
          <span className="flex-1" />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-quaternary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${totalTools} capabilities...`}
              className="pl-9 pr-3 py-1.5 text-sm bg-surface-sunken border border-surface-border rounded-md text-text-primary placeholder:text-text-quaternary focus:outline-none focus:ring-1 focus:ring-accent/50 w-56"
            />
          </div>
        </div>
      )}

      <div className="flex gap-0">
        {/* Main content */}
        <div className={`${tryTool ? 'flex-1 min-w-0' : 'w-full'} transition-all`}>
          {isLoading ? (
            <div className="animate-pulse space-y-6">
              {[1, 2, 3].map((i) => (
                <div key={i}>
                  <div className="h-5 bg-surface-sunken rounded w-32 mb-4" />
                  <div className="space-y-2">
                    <div className="h-4 bg-surface-sunken rounded w-full" />
                    <div className="h-4 bg-surface-sunken rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-text-tertiary mt-8">
              {search || activeCategory ? 'No capabilities match your filter.' : 'No capabilities registered yet.'}
            </p>
          ) : (
            <div className="space-y-10">
              {filtered.map((category) => {
                const meta = CATEGORY_META[category.name] ?? CATEGORY_META.Other;
                const Icon = meta.icon;
                return (
                  <div key={category.name}>
                    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-surface-border">
                      <Icon className={`w-4.5 h-4.5 ${meta.color}`} strokeWidth={1.5} />
                      <h2 className="text-sm font-semibold uppercase tracking-widest text-accent/80">{category.name}</h2>
                      <span className="text-xs text-text-quaternary">{category.tools.length}</span>
                    </div>
                    <div className="space-y-0.5">
                      {category.tools.map((tool) => (
                        <ToolRow
                          key={`${tool.serverId}-${tool.name}`}
                          tool={tool}

                          onTry={() =>
                            setTryTool({
                              serverId: tool.serverId,
                              serverName: tool.serverName,
                              tool: { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Try tool panel — sticky right sidebar */}
        {tryTool && (
          <div className="w-[380px] shrink-0 sticky top-0 max-h-screen overflow-y-auto">
            <ToolTestPanel
              serverId={tryTool.serverId}
              serverName={tryTool.serverName}
              tool={tryTool.tool}
              onClose={() => setTryTool(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tool Row ────────────────────────────────────────────────────────────────

function ToolRow({
  tool,
  onTry,
}: {
  tool: CapabilityTool;
  onTry: () => void;
}) {
  const params = Object.keys(tool.inputSchema?.properties ?? {});

  return (
    <button
      onClick={onTry}
      className="group w-full py-2 px-2 rounded-md hover:bg-surface-hover transition-colors text-left flex gap-4 items-start"
    >
      {/* Col 1: tool name — wider */}
      <div className="w-56 shrink-0">
        <ToolPill name={tool.name} size="md" />
      </div>
      {/* Col 2: params — inline with middot delimiter */}
      <div className="w-44 shrink-0 pt-0.5">
        {params.length > 0 && (
          <p className="text-[9px] font-mono text-text-quaternary/70 leading-relaxed">
            {params.map((p, i) => i < params.length - 1
              ? <span key={p}><span className="whitespace-nowrap">{p} ·</span> </span>
              : <span key={p}>{p}</span>
            )}
          </p>
        )}
      </div>
      {/* Col 3: description — takes remaining */}
      <p className="text-[11px] text-text-tertiary leading-relaxed flex-1 pt-0.5">{tool.description}</p>
      {/* Col 4: server */}
      <div className="shrink-0 flex items-center gap-1.5 pt-0.5">
        <ServerName name={tool.serverName} serverId={tool.serverId} />
        <Play className="w-2.5 h-2.5 text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}
