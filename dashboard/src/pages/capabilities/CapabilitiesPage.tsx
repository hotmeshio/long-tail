import { useState, useMemo } from 'react';
import {
  Search, Play,
  MessageSquare, Eye, Database, Cog, Code2, Shield, BookOpen,
  LayoutGrid, Image, Zap,
} from 'lucide-react';
import { useCapabilities, type CapabilityTool } from '../../api/capabilities';
import { ToolTestPanel } from '../../components/common/test/ToolTestPanel';
import { ToolPill } from '../../components/common/display/ToolPill';
import { ServerName } from '../../components/common/display/ServerName';
import { PageHeader } from '../../components/common/layout/PageHeader';
import type { LucideIcon } from 'lucide-react';

// ── Category meta ─────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: LucideIcon; color: string }> = {
  Communication: { icon: MessageSquare, color: 'text-blue-400' },
  Analysis:      { icon: Eye,           color: 'text-violet-400' },
  Media:         { icon: Image,         color: 'text-pink-400' },
  Data:          { icon: Database,      color: 'text-emerald-400' },
  Automation:    { icon: Cog,           color: 'text-amber-400' },
  Development:   { icon: Code2,         color: 'text-cyan-400' },
  System:        { icon: Shield,        color: 'text-red-400' },
  Reference:     { icon: BookOpen,      color: 'text-text-tertiary' },
  Other:         { icon: LayoutGrid,    color: 'text-text-tertiary' },
};

// ── Page ─────────────────────────────────────────────────────────────────────

export function CapabilitiesPage() {
  const { data, isLoading } = useCapabilities();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    serverId: string;
    serverName: string;
    tool: { name: string; description: string; inputSchema: Record<string, any> };
  } | null>(null);

  const categories = data?.categories ?? [];
  const totalTools = data?.totalTools ?? 0;

  const filtered = useMemo(() => {
    let cats = categories;
    if (activeCategory) cats = cats.filter((c) => c.name === activeCategory);
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

      {/* Two-panel grid */}
      <div className="grid grid-cols-3 gap-8 items-start">

        {/* ── Left: filter bar + capability list (2 cols) ── */}
        <div className="col-span-2">

          {/* Sticky: category tabs + search — spans only the list column */}
          {!isLoading && categories.length > 0 && (
            <div className="sticky top-0 z-20 bg-surface pt-3 pb-3">
            <div className="bg-[#F7F7F7] rounded-lg px-5 pt-3 pb-3 flex items-center gap-5">
              <button
                onClick={() => setActiveCategory(null)}
                className={`flex flex-col items-center gap-1 transition-colors ${
                  activeCategory === null ? 'text-accent' : 'text-text-quaternary hover:text-text-secondary'
                }`}
              >
                <LayoutGrid className="w-3 h-3" strokeWidth={1.5} />
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
                    <Icon className="w-3 h-3" strokeWidth={1.5} />
                    <span className="text-[9px] font-medium">{cat.name}</span>
                  </button>
                );
              })}
              <span className="flex-1" />
              <div className="relative">
                <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-3 text-text-quaternary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${totalTools} capabilities…`}
                  className="pl-5 py-1 text-sm bg-transparent border-b border-surface-border/60 text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent/50 transition-colors w-48"
                />
              </div>
            </div>
            </div>
          )}

          {/* Capability list */}
          {isLoading ? (
            <div className="animate-pulse space-y-8">
              {[1, 2, 3].map((i) => (
                <div key={i}>
                  <div className="h-4 bg-surface-sunken rounded w-28 mb-4" />
                  <div className="space-y-3">
                    {[1, 2, 3].map((j) => (
                      <div key={j} className="space-y-1.5">
                        <div className="h-4 bg-surface-sunken rounded w-36" />
                        <div className="h-3 bg-surface-sunken rounded w-full" />
                      </div>
                    ))}
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
                    <div className="sticky top-[78px] z-10 bg-surface flex items-center gap-2 py-2 mb-2 border-b border-surface-border">
                      <Icon className={`w-3 h-3 ${meta.color}`} strokeWidth={1.5} />
                      <h2 className="section-h2">{category.name}</h2>
                      <span className="text-xs text-text-quaternary">{category.tools.length}</span>
                    </div>
                    <div className="divide-y divide-surface-border/30">
                      {category.tools.map((tool) => (
                        <ToolRow
                          key={`${tool.serverId}-${tool.name}`}
                          tool={tool}
                          isSelected={selected?.tool.name === tool.name && selected?.serverId === tool.serverId}
                          onSelect={() =>
                            setSelected({
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

        {/* ── Right: run panel (1 col, sticky) ── */}
        <div className="sticky top-4">
          {selected ? (
            <ToolTestPanel
              serverId={selected.serverId}
              serverName={selected.serverName}
              tool={selected.tool}
              onClose={() => setSelected(null)}
            />
          ) : (
            <EmptyRunPanel />
          )}
        </div>

      </div>
    </div>
  );
}

// ── Empty run panel ──────────────────────────────────────────────────────────

function EmptyRunPanel() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <Zap className="w-7 h-7 text-text-quaternary" strokeWidth={1} />
      <p className="text-sm text-text-tertiary">Select a capability</p>
      <p className="text-xs text-text-quaternary leading-relaxed max-w-[200px]">
        Explore its inputs, run it live, and inspect the response.
      </p>
    </div>
  );
}

// ── Tool row ─────────────────────────────────────────────────────────────────

function ToolRow({
  tool,
  isSelected,
  onSelect,
}: {
  tool: CapabilityTool;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      className="group relative py-3 px-3 -mx-3 rounded-md cursor-pointer transition-colors text-left"
    >
      {isSelected && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />}
      <div className="flex items-center justify-between gap-3 mb-1">
        <ToolPill name={tool.name} size="md" />
        <div className="flex items-center gap-2 shrink-0">
          <ServerName name={tool.serverName} serverId={tool.serverId} />
          <Play
            className={`w-3 h-3 transition-opacity ${isSelected ? 'text-accent opacity-100' : 'text-accent opacity-0 group-hover:opacity-100'}`}
            strokeWidth={1.5}
          />
        </div>
      </div>
      <p className="text-[11px] text-text-tertiary group-hover:text-text-secondary leading-relaxed line-clamp-2 pl-0.5 transition-colors">
        {tool.description}
      </p>
    </div>
  );
}
