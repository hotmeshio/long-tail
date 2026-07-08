import { useState, useMemo } from 'react';
import {
  Play,
  MessageSquare, Eye, Database, Cog, Code2, Shield, BookOpen,
  LayoutGrid, Image, Zap,
} from 'lucide-react';
import { useCapabilities, type CapabilityTool } from '../../api/capabilities';
import { ToolTestPanel } from '../../components/common/test/ToolTestPanel';
import { ToolPill } from '../../components/common/display/ToolPill';
import { ServerName } from '../../components/common/display/ServerName';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/data/FilterBar';
import type { LucideIcon } from 'lucide-react';

// ── Category meta ─────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Communication: MessageSquare,
  Analysis: Eye,
  Media: Image,
  Data: Database,
  Automation: Cog,
  Development: Code2,
  System: Shield,
  Reference: BookOpen,
  Other: LayoutGrid,
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

          {/* Sticky: category select + search — spans only the list column */}
          {!isLoading && categories.length > 0 && (
            <FilterBar>
              <FilterSelect
                label="Category"
                value={activeCategory ?? ''}
                onChange={(v) => setActiveCategory(v || null)}
                options={categories.map((c) => ({ value: c.name, label: c.name }))}
              />
              <FilterInput
                label="Search"
                value={search}
                onChange={setSearch}
                placeholder={`${totalTools} capabilities…`}
              />
            </FilterBar>
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
                const Icon = CATEGORY_ICONS[category.name] ?? CATEGORY_ICONS.Other;
                return (
                  <div key={category.name}>
                    <div className="sticky top-[60px] z-10 bg-surface flex items-center gap-2 py-2 mb-2 border-b border-surface-border">
                      <Icon className="w-3 h-3 text-accent" strokeWidth={1.5} />
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
      className="group relative py-2 px-3 -mx-3 rounded-md cursor-pointer transition-colors text-left"
    >
      {isSelected && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />}
      <div className="flex items-center gap-3">
        <ToolPill name={tool.name} size="md" />
        <p className="flex-1 min-w-0 truncate text-[11px] text-text-tertiary group-hover:text-text-secondary transition-colors">
          {tool.description}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <ServerName name={tool.serverName} serverId={tool.serverId} />
          <Play
            className={`w-3 h-3 transition-opacity ${isSelected ? 'text-accent opacity-100' : 'text-accent opacity-0 group-hover:opacity-100'}`}
            strokeWidth={1.5}
          />
        </div>
      </div>
    </div>
  );
}
