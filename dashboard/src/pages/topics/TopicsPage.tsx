import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LayoutGrid, Radio,
  CheckSquare, GitBranch, AlertTriangle, Zap,
  BookOpen, Bot, AppWindow, Flag,
} from 'lucide-react';
import { useTopics, type TopicCatalogEntry } from '../../api/topics';
import { PageHeader } from '../../components/common/layout/PageHeader';
import type { LucideIcon } from 'lucide-react';

// ── Category meta ──────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: LucideIcon; color: string }> = {
  task:       { icon: CheckSquare,   color: 'text-blue-400' },
  workflow:   { icon: GitBranch,     color: 'text-accent' },
  escalation: { icon: AlertTriangle, color: 'text-amber-400' },
  activity:   { icon: Zap,           color: 'text-cyan-400' },
  knowledge:  { icon: BookOpen,      color: 'text-violet-400' },
  agent:      { icon: Bot,           color: 'text-emerald-400' },
  app:        { icon: AppWindow,     color: 'text-rose-400' },
  milestone:  { icon: Flag,          color: 'text-violet-400' },
};

const CATEGORY_COLORS: Record<string, string> = {
  task:       'bg-blue-400/15 text-blue-400',
  workflow:   'bg-accent/15 text-accent',
  escalation: 'bg-amber-400/15 text-amber-400',
  activity:   'bg-cyan-400/15 text-cyan-400',
  knowledge:  'bg-violet-400/15 text-violet-400',
  agent:      'bg-emerald-400/15 text-emerald-400',
  app:        'bg-rose-400/15 text-rose-400',
  milestone:  'bg-violet-400/15 text-violet-400',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export function TopicsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const { data, isLoading } = useTopics({ limit: 500 });
  const allTopics: TopicCatalogEntry[] = data?.topics ?? [];

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTopics) seen.add(t.category);
    return Array.from(seen).sort();
  }, [allTopics]);

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const cats = activeCategory ? [activeCategory] : categories;
    return cats
      .map((cat) => ({
        name: cat,
        topics: allTopics.filter(
          (t) =>
            t.category === cat &&
            (!q || t.topic.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.topics.length > 0);
  }, [allTopics, categories, search, activeCategory]);

  return (
    <div>
      <PageHeader title="Event Topics" docsHash="#docs:topics.md" />

      {/* Sticky filter bar: category icons + search */}
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
            const meta = CATEGORY_META[cat] ?? { icon: Radio, color: 'text-text-tertiary' };
            const Icon = meta.icon;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(isActive ? null : cat)}
                className={`flex flex-col items-center gap-1 transition-colors ${
                  isActive ? meta.color : 'text-text-quaternary hover:text-text-secondary'
                }`}
              >
                <Icon className="w-3 h-3" strokeWidth={1.5} />
                <span className="text-[9px] font-medium capitalize">{cat}</span>
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
              placeholder={`Search ${allTopics.length} topics…`}
              className="pl-5 py-1 text-sm bg-transparent border-b border-surface-border/60 text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent/50 transition-colors w-48"
            />
          </div>
        </div>
        </div>
      )}

      {/* Topic list */}
      {isLoading ? (
        <div className="animate-pulse space-y-8 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-4 bg-surface-sunken rounded w-28 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="space-y-1.5">
                    <div className="h-3 bg-surface-sunken rounded w-64" />
                    <div className="h-3 bg-surface-sunken rounded w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-text-tertiary mt-8">
          {search || activeCategory ? 'No topics match your filter.' : 'No topics registered yet.'}
        </p>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ name, topics }) => {
            const meta = CATEGORY_META[name] ?? { icon: Radio, color: 'text-text-tertiary' };
            const Icon = meta.icon;
            return (
              <div key={name}>
                <div className="sticky top-[78px] z-10 bg-surface flex items-center gap-2 py-2 mb-2 border-b border-surface-border">
                  <Icon className={`w-3 h-3 ${meta.color}`} strokeWidth={1.5} />
                  <h2 className="section-h2 capitalize">{name}</h2>
                  <span className="text-xs text-text-quaternary">{topics.length}</span>
                </div>
                <div className="divide-y divide-surface-border/30">
                  {topics.map((topic) => (
                    <TopicRow
                      key={topic.topic}
                      topic={topic}
                      onClick={() => navigate(`/topics/${encodeURIComponent(topic.topic)}`)}
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

// ── Topic row ──────────────────────────────────────────────────────────────────

function TopicRow({ topic, onClick }: { topic: TopicCatalogEntry; onClick: () => void }) {
  const pillCls = CATEGORY_COLORS[topic.category] ?? 'bg-zinc-400/15 text-zinc-400';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="group py-3 px-3 -mx-3 rounded-md cursor-pointer transition-colors text-left"
    >
      <div className="flex items-center gap-3 mb-0.5">
        <Radio className="w-3 h-3 shrink-0 text-text-quaternary group-hover:text-text-tertiary transition-colors" strokeWidth={1.5} />
        <span className="text-xs font-mono text-text-primary truncate">{topic.topic}</span>
        <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${pillCls}`}>
          {topic.category}
        </span>
        {(topic.subscriber_count ?? 0) > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 rounded-full text-[10px] font-medium bg-accent/15 text-accent shrink-0">
            {topic.subscriber_count}
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-text-quaternary shrink-0">{topic.source}</span>
      </div>
      {topic.description && (
        <p className="pl-6 text-[11px] text-text-tertiary group-hover:text-text-secondary leading-relaxed line-clamp-1 transition-colors">
          {topic.description}
        </p>
      )}
    </div>
  );
}
