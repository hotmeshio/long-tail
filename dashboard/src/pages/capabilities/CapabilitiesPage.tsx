import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Play,
  MessageSquare, Eye, Database, Cog, Code2, Shield, BookOpen,
  LayoutGrid, Image,
} from 'lucide-react';
import { useCapabilities, type CapabilityTool } from '../../api/capabilities';
import { ToolTestPanel } from '../../components/common/test/ToolTestPanel';
import { ToolPill } from '../../components/common/display/ToolPill';
import { ServerName } from '../../components/common/display/ServerName';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/data/FilterBar';
import { useShellPanelOptional } from '../../hooks/useShellPanel';
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

// Shell-panel ownership key — the tool run panel claims/releases this slot.
const CAPABILITY_PANEL_KEY = 'capability-run';

interface SelectedTool {
  serverId: string;
  serverName: string;
  tool: { name: string; description: string; inputSchema: Record<string, any> };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function CapabilitiesPage() {
  const { data, isLoading } = useCapabilities();
  const shell = useShellPanelOptional();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedTool | null>(null);

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

  // ── Selection ↔ shell panel sync ────────────────────────────────────────────
  // Selecting a tool opens the run panel in the shell's right slot; an
  // external close (the panel's X, slot takeover) clears the selection. The
  // applied-key ref guards against re-setting the panel on unrelated renders.
  const selectedKey = selected ? `${selected.serverId}:${selected.tool.name}` : null;
  const appliedKey = useRef<string | null>(null);
  const panelWasOpen = useRef(false);
  useEffect(() => {
    if (!shell) return;
    if (selectedKey === appliedKey.current) return;
    appliedKey.current = selectedKey;
    if (selected) {
      shell.setPanel(
        <div className="h-full overflow-y-auto">
          <ToolTestPanel
            serverId={selected.serverId}
            serverName={selected.serverName}
            tool={selected.tool}
            onClose={() => setSelected(null)}
          />
        </div>,
        { key: CAPABILITY_PANEL_KEY, width: 420 },
      );
    } else {
      panelWasOpen.current = false;
      shell.closePanel(CAPABILITY_PANEL_KEY);
    }
  }, [selected, selectedKey, shell]);
  useEffect(() => {
    if (!shell || !selected) return;
    if (shell.open && shell.ownerKey === CAPABILITY_PANEL_KEY) {
      panelWasOpen.current = true;
      return;
    }
    if (panelWasOpen.current) {
      panelWasOpen.current = false;
      setSelected(null);
    }
  }, [shell, selected]);
  // Unmount with the panel open releases the slot (keyed — never yanks
  // another claimant's panel).
  const shellRef = useRef(shell);
  shellRef.current = shell;
  useEffect(
    () => () => {
      if (appliedKey.current) shellRef.current?.closePanel(CAPABILITY_PANEL_KEY);
    },
    [],
  );

  return (
    <div>
      <PageHeader title="Capabilities" />

      {/* The standard full-width sticky filter band — above the list, like
          every other master list page. */}
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

      {/* The list IS the page — selecting a row opens the run panel in the
          shell's right panel. */}
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
      className="group relative py-2 px-3 -mx-3 rounded-md cursor-pointer hover:bg-surface-hover/30 transition-colors text-left"
    >
      {isSelected && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />}
      <div className="flex items-center gap-3">
        <ToolPill name={tool.name} size="md" />
        <p className="flex-1 min-w-0 truncate text-2xs text-text-tertiary group-hover:text-text-secondary transition-colors">
          {tool.description}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <ServerName name={tool.serverName} serverId={tool.serverId} />
          {/* Trailing action icon — quiet until row hover, visible on the
              selected row. Selecting opens the run panel in the shell panel. */}
          <span title="Try it">
            <Play
              className={`w-3 h-3 transition-opacity ${isSelected ? 'text-accent opacity-100' : 'text-accent opacity-0 group-hover:opacity-100'}`}
              strokeWidth={1.5}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
